//! Ferramentas: conversor de arquivos (ffmpeg embutido) e downloader de vídeo por link (yt-dlp).
//!
//! - O ffmpeg vai dentro do instalador (`bin/ffmpeg.exe`, build GPL do BtbN com versão fixa,
//!   baixada por `scripts/fetch-ffmpeg.mjs`; licença e código-fonte em `bin/FFMPEG-NOTICE.txt`).
//!   Cada conversão é um processo com progresso real (`-progress pipe:1`).
//! - O yt-dlp é baixado do release oficial no GitHub no primeiro uso, com o consentimento do
//!   usuário, e só é aceito se o SHA-256 bater com o `SHA2-256SUMS` do mesmo release.
//! - A detecção de link olha a área de transferência só pelo contador de sequência do Windows;
//!   o texto só é lido quando muda, nunca é guardado, e só links de vídeo geram aviso.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};

/// Extensão dos executáveis deste sistema.
const EXE: &str = if cfg!(windows) { ".exe" } else { "" };
/// O curl vem com o Windows 10+, o macOS e as distribuições Linux.
const CURL: &str = if cfg!(windows) { "curl.exe" } else { "curl" };

/// O asset do yt-dlp para este sistema, como aparece no SHA2-256SUMS do release.
#[cfg(windows)]
const YTDLP_ASSET: &str = "yt-dlp.exe";
#[cfg(target_os = "macos")]
const YTDLP_ASSET: &str = "yt-dlp_macos";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const YTDLP_ASSET: &str = "yt-dlp_linux_aarch64";
#[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
const YTDLP_ASSET: &str = "yt-dlp_linux";
const YTDLP_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/// gallery-dl (imagens e pastas do Pinterest). Versão FIXA com o SHA-256 que o GitHub publica para o
/// asset: as releases mais novas não trazem mais o .exe, e fixar o hash é a verificação mais forte.
/// No macOS não há binário oficial: vale o que o Homebrew instalou (`brew install gallery-dl`).
#[cfg(windows)]
const GALLERYDL: Option<(&str, &str)> = Some(("gallery-dl.exe", "3f8bec31523a3f78e0f716a12e090db948945eabebd5b3e5132cd0bd1d8ce2f3"));
#[cfg(target_os = "linux")]
const GALLERYDL: Option<(&str, &str)> = Some(("gallery-dl.bin", "5178498af87a7eac6eaf0de9269d90ef02245465ae10c074440ab863c1604224"));
#[cfg(target_os = "macos")]
const GALLERYDL: Option<(&str, &str)> = None;
const GALLERYDL_BASE: &str = "https://github.com/mikf/gallery-dl/releases/download/v1.31.2";

#[derive(Default)]
pub struct Tools {
    jobs: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
    /// Trabalhos sem processo filho (PDF → imagem) olham esta bandeira entre uma página e outra.
    stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
    counter: AtomicU64,
    watch: Arc<AtomicBool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub id: String,
    pub kind: String,
    /// "running" | "done" | "error" | "canceled"
    pub status: String,
    pub progress: Option<f64>,
    pub title: String,
    pub output: Option<String>,
    pub error: Option<String>,
    /// Miniatura (data URL JPEG/PNG/WEBP) — capa do vídeo baixado ou quadro do arquivo.
    pub thumb: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub path: String,
    pub name: String,
    pub ext: String,
    /// "image" | "video" | "audio" | "other"
    pub kind: String,
    pub size: Option<u64>,
}

pub fn kind_of(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "ico" | "avif" | "heic" | "jfif" => "image",
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "flv" | "m4v" | "mpg" | "mpeg" | "3gp" | "ts" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" | "opus" | "wma" | "aiff" | "alac" => "audio",
        "pdf" => "pdf",
        _ => "other",
    }
}

/// Formatos de saída permitidos para cada tipo de entrada.
pub fn targets_for(kind: &str) -> &'static [&'static str] {
    match kind {
        "image" => &["png", "jpg", "pdf", "webp", "ico", "bmp"],
        "video" => &["mp4", "webm", "mov", "gif", "mp3", "wav", "m4a"],
        "audio" => &["mp3", "wav", "m4a", "ogg", "flac", "opus"],
        "pdf" => &["png", "jpg", "webp"],
        _ => &[],
    }
}

/// Argumentos do ffmpeg para o formato de saída (entre `-i <entrada>` e `<saída>`).
pub fn ffmpeg_args(kind: &str, target: &str) -> Option<Vec<&'static str>> {
    if !targets_for(kind).contains(&target) {
        return None;
    }
    Some(match (kind, target) {
        ("image", "png") | ("image", "bmp") => vec!["-frames:v", "1"],
        ("image", "jpg") => vec!["-frames:v", "1", "-q:v", "2"],
        ("image", "webp") => vec!["-frames:v", "1", "-quality", "90"],
        ("image", "ico") => vec!["-frames:v", "1", "-vf", "scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease"],
        (_, "mp4") | (_, "mov") => vec!["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
        (_, "webm") => vec!["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"],
        ("video", "gif") => vec!["-vf", "fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", "-an"],
        (_, "mp3") => vec!["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
        (_, "wav") => vec!["-vn", "-c:a", "pcm_s16le"],
        (_, "m4a") => vec!["-vn", "-c:a", "aac", "-b:a", "256k"],
        (_, "ogg") => vec!["-vn", "-c:a", "libvorbis", "-q:a", "6"],
        (_, "flac") => vec!["-vn", "-c:a", "flac"],
        (_, "opus") => vec!["-vn", "-c:a", "libopus", "-b:a", "160k"],
        _ => return None,
    })
}

/// Caminho de saída ao lado do original, sem nunca sobrescrever: "foto (VANTA).png", "(VANTA 2)"…
pub fn output_path(input: &Path, target: &str, folder: Option<&Path>) -> PathBuf {
    let dir = folder.map(Path::to_path_buf).unwrap_or_else(|| input.parent().map(Path::to_path_buf).unwrap_or_default());
    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "arquivo".into());
    let ext = if target == "jpg" { "jpg" } else { target };
    let mut n = 1;
    loop {
        let label = if n == 1 { "(VANTA)".to_string() } else { format!("(VANTA {n})") };
        let p = dir.join(format!("{stem} {label}.{ext}"));
        if !p.exists() {
            return p;
        }
        n += 1;
    }
}

/// "Duration: 00:03:12.45" -> milissegundos.
pub fn parse_duration_ms(line: &str) -> Option<f64> {
    let idx = line.find("Duration: ")?;
    let t = line[idx + 10..].split(',').next()?.trim();
    let mut parts = t.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(((h * 60.0 + m) * 60.0 + s) * 1000.0)
}

/// "[download]  42.3% of ..." -> 0.423
pub fn parse_ytdlp_percent(line: &str) -> Option<f64> {
    let rest = line.strip_prefix("[download]")?.trim_start();
    let pct = rest.split('%').next()?.trim();
    pct.parse::<f64>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0))
}

fn is_pinterest_host(h: &str) -> bool {
    let h = h.strip_prefix("br.").or_else(|| h.split_once('.').filter(|(sub, _)| sub.len() == 2).map(|(_, rest)| rest)).unwrap_or(h);
    h.starts_with("pinterest.") && h.len() <= 20
}

/// Link do Pinterest (pin, pasta ou pin.it)? Esses vão para o gallery-dl, como imagem.
pub fn is_pinterest(url: &str) -> bool {
    video_site(url) == Some("Pinterest")
}

/// Quem baixa o link: post do Instagram (/p/, fotos e carrosséis) e Pinterest vão para o gallery-dl
/// como imagem; reels, vídeos e o resto vão para o yt-dlp. O usuário só cola o link.
pub fn is_gallery_link(url: &str) -> bool {
    if is_pinterest(url) {
        return true;
    }
    video_site(url) == Some("Instagram") && {
        let rest = url.trim().trim_start_matches("https://");
        let path = rest.split_once('/').map(|(_, p)| p).unwrap_or("");
        // /p/<id> ou /<usuário>/p/<id>
        path.starts_with("p/") || path.split('/').nth(1) == Some("p")
    }
}

/// O Instagram recusa conteúdo sem login com mensagens diferentes; vira uma frase só.
fn friendly_error(detail: &str) -> Option<String> {
    let d = detail.to_ascii_lowercase();
    (d.contains("instagram") && (d.contains("login") || d.contains("429") || d.contains("rate-limit") || d.contains("rate limit") || d.contains("not available")))
        .then(|| "o Instagram pediu login para esse conteúdo — por enquanto só dá para baixar o que é público sem conta".to_string())
}

/// Link de vídeo de um site conhecido? Devolve o nome do site.
pub fn video_site(text: &str) -> Option<&'static str> {
    let t = text.trim();
    if t.len() > 2048 || t.contains(char::is_whitespace) || !t.starts_with("https://") {
        return None;
    }
    let rest = &t[8..];
    let host = rest.split(['/', '?', '#']).next()?.trim_start_matches("www.").trim_start_matches("m.").to_ascii_lowercase();
    let path = rest.get(host.len()..).unwrap_or("").to_ascii_lowercase();
    let path = path.trim_start_matches(|c| c != '/');
    let site = match host.as_str() {
        h if is_pinterest_host(h) && path.len() > 1 => "Pinterest",
        "pin.it" if path.len() > 1 => "Pinterest",
        "youtube.com" | "music.youtube.com" if path.starts_with("/watch") || path.starts_with("/shorts/") || path.starts_with("/live/") => "YouTube",
        "youtu.be" if path.len() > 1 => "YouTube",
        // /reel/x, /p/x, /tv/x — e as mesmas atrás do usuário: /fulano/p/x, /fulano/reel/x
        "instagram.com" if ["/reel", "/p/", "/tv/"].iter().any(|k| path.starts_with(k) || path.split_once('/').and_then(|(_, r)| r.split_once('/')).is_some_and(|(_, r)| r.starts_with(&k[1..]))) => "Instagram",
        "tiktok.com" if path.contains("/video/") => "TikTok",
        "vm.tiktok.com" | "vt.tiktok.com" if path.len() > 1 => "TikTok",
        "x.com" | "twitter.com" if path.contains("/status/") => "X",
        "vimeo.com" if path.len() > 1 && path[1..].chars().next().is_some_and(|c| c.is_ascii_digit()) => "Vimeo",
        "twitch.tv" if path.contains("/clip/") || path.starts_with("/videos/") => "Twitch",
        "clips.twitch.tv" if path.len() > 1 => "Twitch",
        "facebook.com" if path.contains("/videos/") || path.starts_with("/reel") || path.starts_with("/watch") => "Facebook",
        "fb.watch" if path.len() > 1 => "Facebook",
        "reddit.com" if path.contains("/comments/") => "Reddit",
        "soundcloud.com" if path.matches('/').count() >= 2 => "SoundCloud",
        "dailymotion.com" if path.starts_with("/video/") => "Dailymotion",
        _ => return None,
    };
    Some(site)
}

/// Linhas da saída de um processo, tolerando bytes que não são UTF-8. `BufRead::lines()` para no
/// primeiro byte inválido — e parar de ler fecha o pipe: o processo do outro lado falha na escrita
/// seguinte (no Windows, "[Errno 22] Invalid argument"). Foi o que derrubava downloads com acento.
fn lossy_lines<R: Read>(r: R) -> impl Iterator<Item = String> {
    BufReader::new(r).split(b'\n').map_while(Result::ok).map(|l| String::from_utf8_lossy(&l).trim_end_matches('\r').to_string())
}

// ------------------------------------------------------------------ miniaturas

/// Tipo de imagem pelos bytes (nunca pela extensão ou pelo que o servidor declara).
fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn data_url(b: &[u8]) -> Option<String> {
    use base64::Engine;
    if b.is_empty() || b.len() > 3 * 1024 * 1024 {
        return None;
    }
    let mime = image_mime(b)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

/// Um quadro pequeno (160 px) de imagem, vídeo ou capa de áudio, pelo ffmpeg, direto no stdout.
fn ffmpeg_thumb(ffmpeg: &Path, input: &Path, seek: bool) -> Option<Vec<u8>> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if seek {
        cmd.args(["-ss", "1"]);
    }
    cmd.arg("-i")
        .arg(input)
        .args(["-map", "0:v:0", "-frames:v", "1", "-vf", "scale=160:-2", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "5", "pipe:1"])
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    let out = hidden(&mut cmd).output().ok()?;
    (out.status.success() && !out.stdout.is_empty()).then_some(out.stdout)
}

fn thumb_for(ffmpeg: &Path, input: &Path) -> Option<String> {
    let ext = input.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match kind_of(&ext) {
        "video" => ffmpeg_thumb(ffmpeg, input, true).or_else(|| ffmpeg_thumb(ffmpeg, input, false)).and_then(|b| data_url(&b)),
        "image" | "audio" => ffmpeg_thumb(ffmpeg, input, false).and_then(|b| data_url(&b)),
        "pdf" => pdf_first_page_thumb(input, ffmpeg.parent().unwrap_or(Path::new("."))).and_then(|b| data_url(&b)),
        _ => None,
    }
}

fn pdf_first_page_thumb(input: &Path, lib_dir: &Path) -> Option<Vec<u8>> {
    let doc = pdf::Doc::open(input, lib_dir).ok()?;
    doc.render(0, Some(160)).ok()
}

/// PDF → imagem: o renderizador do próprio Windows (Windows.Data.Pdf) ou, no Linux e no macOS,
/// o PDFium que vai junto em `bin/` (o motor de PDF do Chromium, licença BSD).
mod pdf {
    use std::path::Path;

    #[cfg(windows)]
    pub struct Doc(windows::Data::Pdf::PdfDocument);

    #[cfg(windows)]
    impl Doc {
        pub fn open(path: &Path, _lib_dir: &Path) -> Result<Self, String> {
            use windows::core::HSTRING;
            use windows::Data::Pdf::PdfDocument;
            use windows::Storage::StorageFile;
            unsafe {
                let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
            }
            let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str())).and_then(|op| op.join()).map_err(|e| format!("não foi possível abrir o PDF: {}", e.message()))?;
            PdfDocument::LoadFromFileAsync(&file)
                .and_then(|op| op.join())
                .map(Doc)
                .map_err(|e| if e.code().0 as u32 == 0x8007_0005 { "o PDF está protegido por senha".to_string() } else { format!("PDF ilegível: {}", e.message()) })
        }

        pub fn pages(&self) -> Result<u32, String> {
            self.0.PageCount().map_err(|e| e.message().to_string())
        }

        /// PNG da página; sem largura pedida, 2× o tamanho da página (~192 ppp), até 6000 px.
        pub fn render(&self, index: u32, width: Option<u32>) -> Result<Vec<u8>, String> {
            use windows::Data::Pdf::PdfPageRenderOptions;
            use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
            let r = || -> windows::core::Result<Vec<u8>> {
                let page = self.0.GetPage(index)?;
                let size = page.Size()?;
                let opts = PdfPageRenderOptions::new()?;
                let scale = (6000.0 / size.Width.max(size.Height).max(1.0)).min(2.0);
                opts.SetDestinationWidth(width.unwrap_or_else(|| (size.Width * scale).round().max(1.0) as u32))?;
                let stream = InMemoryRandomAccessStream::new()?;
                page.RenderWithOptionsToStreamAsync(&stream, &opts)?.join()?;
                let len = stream.Size()? as u32;
                let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
                reader.LoadAsync(len)?.join()?;
                let mut buf = vec![0u8; len as usize];
                reader.ReadBytes(&mut buf)?;
                Ok(buf)
            };
            r().map_err(|e| e.message().to_string())
        }
    }

    #[cfg(not(windows))]
    pub struct Doc(pdfium_render::prelude::PdfDocument<'static>);

    /// O `Pdfium` não é `Send`/`Sync`, então não cabe num `static`: cada thread liga a biblioteca
    /// uma vez e guarda a sua. Abrir e desenhar acontecem sempre na mesma thread (spawn_blocking).
    /// A ligação em si passa por um cadeado: a inicialização do PDFium não é segura em paralelo.
    #[cfg(not(windows))]
    fn pdfium(lib_dir: &Path) -> Result<&'static pdfium_render::prelude::Pdfium, String> {
        use pdfium_render::prelude::Pdfium;
        use std::cell::OnceCell;
        static BIND: std::sync::Mutex<()> = std::sync::Mutex::new(());
        thread_local!(static PDFIUM: OnceCell<Option<&'static Pdfium>> = const { OnceCell::new() });
        PDFIUM
            .with(|cell| {
                *cell.get_or_init(|| {
                    let _guard = BIND.lock().unwrap_or_else(|e| e.into_inner());
                    Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(lib_dir))
                        .or_else(|_| Pdfium::bind_to_system_library())
                        .map(|b| &*Box::leak(Box::new(Pdfium::new(b))))
                        .map_err(|e| log::warn!(target: "tools", "PDFium indisponível: {e}"))
                        .ok()
                })
            })
            .ok_or_else(|| "o renderizador de PDF (PDFium) não foi encontrado".to_string())
    }

    #[cfg(not(windows))]
    impl Doc {
        pub fn open(path: &Path, lib_dir: &Path) -> Result<Self, String> {
            pdfium(lib_dir)?.load_pdf_from_file(path, None).map(Doc).map_err(|e| format!("PDF ilegível ou protegido por senha: {e}"))
        }

        pub fn pages(&self) -> Result<u32, String> {
            Ok(self.0.pages().len() as u32)
        }

        /// Mesma escala do Windows: 2 DIP por ponto de 96 ppp, ou seja ~2,67 px por ponto PDF.
        pub fn render(&self, index: u32, width: Option<u32>) -> Result<Vec<u8>, String> {
            use pdfium_render::prelude::PdfRenderConfig;
            let page = self.0.pages().get(index as u16).map_err(|e| e.to_string())?;
            let (w, h) = (page.width().value, page.height().value);
            let scale = (6000.0 / w.max(h).max(1.0)).min(2.0 * 96.0 / 72.0);
            let target = width.unwrap_or_else(|| (w * scale).round().max(1.0) as u32);
            let image = page.render_with_config(&PdfRenderConfig::new().set_target_width(target as i32)).map_err(|e| e.to_string())?.as_image();
            let mut png = Vec::new();
            image.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| e.to_string())?;
            Ok(png)
        }
    }
}

/// Miniatura de um arquivo da fila do conversor. `None` quando não há o que mostrar.
#[tauri::command]
pub async fn tools_thumb(app: AppHandle, path: String) -> AppResult<Option<String>> {
    let input = checked_input(&path)?;
    let ffmpeg = ffmpeg_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || thumb_for(&ffmpeg, &input)).await.map_err(|e| AppError::io(e.to_string()))
}

/// Capa remota do vídeo (só https, até 3 MB, conferida pelos bytes).
fn fetch_thumb(url: &str, tmp: &Path) -> Option<String> {
    let url = url.trim();
    if !url.starts_with("https://") || url.len() > 2048 || url.contains(char::is_whitespace) {
        return None;
    }
    let st = hidden(Command::new(CURL).args(["-L", "--fail", "--silent", "--max-time", "15", "--max-filesize", "3145728", "-o"]).arg(tmp).arg("--").arg(url))
        .status()
        .ok()?;
    let bytes = st.success().then(|| std::fs::read(tmp).ok()).flatten();
    let _ = std::fs::remove_file(tmp);
    data_url(&bytes?)
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn ffmpeg_path(app: &AppHandle) -> AppResult<PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("bin").join(format!("ffmpeg{EXE}"));
        if p.is_file() {
            return Ok(p);
        }
    }
    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(format!("ffmpeg{EXE}"));
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(AppError::unavailable("o conversor (ffmpeg) não está instalado junto com o VANTA"))
}

fn gallerydl_path(app: &AppHandle) -> AppResult<PathBuf> {
    #[cfg(target_os = "macos")]
    for p in ["/opt/homebrew/bin/gallery-dl", "/usr/local/bin/gallery-dl"] {
        if Path::new(p).is_file() {
            return Ok(PathBuf::from(p));
        }
    }
    Ok(app.path().app_data_dir().map_err(|e| AppError::io(e.to_string()))?.join("bin").join(format!("gallery-dl{EXE}")))
}

fn ytdlp_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| AppError::io(e.to_string()))?.join("bin").join(format!("yt-dlp{EXE}")))
}

/// Espera o processo sem segurar a trava (o cancelamento precisa conseguir pegá-la).
/// Devolve (sucesso?, cancelado?).
fn wait_child(slot: &Arc<Mutex<Option<Child>>>) -> (Option<bool>, bool) {
    loop {
        {
            let Ok(mut g) = slot.lock() else { return (Some(false), false) };
            match g.as_mut() {
                None => return (None, true),
                Some(c) => match c.try_wait() {
                    Ok(Some(s)) => return (Some(s.success()), false),
                    Ok(None) => {}
                    Err(_) => return (Some(false), false),
                },
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }
}

fn emit(app: &AppHandle, ev: &JobEvent) {
    let _ = app.emit("tools://job", ev.clone());
}

fn checked_input(path: &str) -> AppResult<PathBuf> {
    if path.is_empty() || path.len() > 2000 || path.contains('\0') || (path.starts_with(r"\\") && !path.starts_with(r"\\?\")) {
        return Err(AppError::invalid("caminho inválido"));
    }
    let p = PathBuf::from(path);
    if !p.is_absolute() || !p.is_file() {
        return Err(AppError::new("missing", "o arquivo não existe mais"));
    }
    Ok(p)
}

#[tauri::command]
pub fn tools_probe(paths: Vec<String>) -> AppResult<Vec<Probe>> {
    if paths.len() > 50 {
        return Err(AppError::invalid("arquivos demais de uma vez (máximo 50)"));
    }
    Ok(paths
        .into_iter()
        .filter_map(|p| {
            let pb = checked_input(&p).ok()?;
            let ext = pb.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            Some(Probe {
                name: pb.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                kind: kind_of(&ext).into(),
                size: std::fs::metadata(&pb).ok().map(|m| m.len()),
                ext,
                path: p,
            })
        })
        .collect())
}

impl Tools {
    fn next_id(&self, kind: &str) -> String {
        format!("{kind}-{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1)
    }
}

/// Converte um arquivo. O resultado chega por eventos `tools://job`.
#[tauri::command]
pub fn convert_start(app: AppHandle, tools: State<'_, Tools>, path: String, target: String, folder: Option<String>) -> AppResult<String> {
    let input = checked_input(&path)?;
    let ext = input.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let kind = kind_of(&ext);
    let out_dir = folder.filter(|f| !f.is_empty()).map(PathBuf::from).filter(|d| d.is_absolute() && d.is_dir());
    if kind == "image" && target == "pdf" {
        return pdf_job(&app, &tools, vec![input], out_dir);
    }
    if kind == "pdf" {
        if !targets_for("pdf").contains(&target.as_str()) {
            return Err(AppError::invalid("conversão não suportada para este arquivo"));
        }
        return pdf_to_images_job(&app, &tools, input, target, out_dir);
    }
    let args = ffmpeg_args(kind, &target).ok_or_else(|| AppError::invalid("conversão não suportada para este arquivo"))?;
    let output = output_path(&input, &target, out_dir.as_deref());
    let ffmpeg = ffmpeg_path(&app)?;
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i"])
        .arg(&input)
        .args(&args)
        .arg(&output)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hidden(&mut cmd).spawn().map_err(|e| AppError::io(format!("não foi possível iniciar o conversor: {e}")))?;
    let id = tools.next_id("convert");
    let title = format!("{} → {}", input.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), target.to_uppercase());
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let slot = Arc::new(Mutex::new(Some(child)));
    tools.jobs.lock().map_err(|_| AppError::io("lock"))?.insert(id.clone(), slot.clone());
    let base = JobEvent { id: id.clone(), kind: "convert".into(), status: "running".into(), progress: Some(0.0), title, output: None, error: None, thumb: None };
    emit(&app, &base);

    let duration = Arc::new(Mutex::new(None::<f64>));
    let tail = Arc::new(Mutex::new(String::new()));
    if let Some(err) = stderr {
        let (d, tl) = (duration.clone(), tail.clone());
        std::thread::spawn(move || {
            for line in lossy_lines(err) {
                if let Some(ms) = parse_duration_ms(&line) {
                    if let Ok(mut g) = d.lock() {
                        g.get_or_insert(ms);
                    }
                }
                if let Ok(mut t) = tl.lock() {
                    *t = line.chars().take(300).collect();
                }
            }
        });
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        if let Some(out) = stdout {
            for line in lossy_lines(out) {
                if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.trim().parse::<f64>().ok()) {
                    let total = duration.lock().ok().and_then(|g| *g);
                    if let Some(total) = total.filter(|t| *t > 0.0) {
                        if last.elapsed() > Duration::from_millis(200) {
                            last = Instant::now();
                            emit(&app2, &JobEvent { progress: Some((us / 1000.0 / total).clamp(0.0, 0.99)), ..base.clone() });
                        }
                    }
                }
            }
        }
        let (ok, canceled) = wait_child(&slot);
        let ev = match ok {
            Some(true) => JobEvent { status: "done".into(), progress: Some(1.0), output: Some(output.to_string_lossy().to_string()), ..base.clone() },
            _ if canceled => {
                let _ = std::fs::remove_file(&output);
                JobEvent { status: "canceled".into(), ..base.clone() }
            }
            _ => {
                let _ = std::fs::remove_file(&output);
                let detail = tail.lock().map(|t| t.clone()).unwrap_or_default();
                JobEvent { status: "error".into(), error: Some(if detail.is_empty() { "a conversão falhou".into() } else { detail }), ..base.clone() }
            }
        };
        emit(&app2, &ev);
    });
    Ok(id)
}

/// Junta várias imagens num PDF só, uma por página, na ordem da lista.
#[tauri::command]
pub fn convert_merge_pdf(app: AppHandle, tools: State<'_, Tools>, paths: Vec<String>, folder: Option<String>) -> AppResult<String> {
    if paths.is_empty() || paths.len() > 200 {
        return Err(AppError::invalid("escolha de 1 a 200 imagens"));
    }
    let mut inputs = Vec::with_capacity(paths.len());
    for p in &paths {
        let input = checked_input(p)?;
        let ext = input.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if kind_of(&ext) != "image" {
            return Err(AppError::invalid("só imagens podem virar páginas de PDF"));
        }
        inputs.push(input);
    }
    let out_dir = folder.filter(|f| !f.is_empty()).map(PathBuf::from).filter(|d| d.is_absolute() && d.is_dir());
    pdf_job(&app, &tools, inputs, out_dir)
}

/// Imagem(ns) → PDF. O ffmpeg achata cada imagem em JPEG (transparência vira branco) e o
/// próprio VANTA monta o PDF com o JPEG embutido (DCTDecode) — sem dependência nova.
fn pdf_job(app: &AppHandle, tools: &Tools, inputs: Vec<PathBuf>, out_dir: Option<PathBuf>) -> AppResult<String> {
    let ffmpeg = ffmpeg_path(app)?;
    let first = inputs.first().ok_or_else(|| AppError::invalid("nenhuma imagem"))?.clone();
    let output = if inputs.len() == 1 {
        output_path(&first, "pdf", out_dir.as_deref())
    } else {
        let stem = first.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imagens".into());
        let named = first.with_file_name(format!("{stem} +{}.pdf", inputs.len() - 1));
        output_path(&named, "pdf", out_dir.as_deref().or(first.parent()))
    };
    let id = tools.next_id("convert");
    let name = first.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let title = if inputs.len() == 1 { format!("{name} → PDF") } else { format!("{} imagens → 1 PDF", inputs.len()) };
    let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    tools.jobs.lock().map_err(|_| AppError::io("lock"))?.insert(id.clone(), slot.clone());
    let base = JobEvent { id: id.clone(), kind: "convert".into(), status: "running".into(), progress: Some(0.0), title, output: None, error: None, thumb: None };
    emit(app, &base);
    let app2 = app.clone();
    let tmp = std::env::temp_dir().join(format!("vanta-{id}"));
    std::thread::spawn(move || {
        let result = (|| -> Result<Option<()>, String> {
            std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
            let mut pages = Vec::with_capacity(inputs.len());
            let n = inputs.len();
            for (i, input) in inputs.iter().enumerate() {
                let jpg = tmp.join(format!("{i}.jpg"));
                let mut cmd = Command::new(&ffmpeg);
                cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
                    .arg(input)
                    .args([
                        "-filter_complex",
                        "[0:v]format=rgba,split[a][b];[a]drawbox=c=white@1:replace=1:t=fill[bg];[bg][b]overlay=format=auto,format=yuvj444p",
                        "-frames:v",
                        "1",
                        "-q:v",
                        "2",
                    ])
                    .arg(&jpg)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                let child = hidden(&mut cmd).spawn().map_err(|e| format!("não foi possível iniciar o conversor: {e}"))?;
                if let Ok(mut g) = slot.lock() {
                    *g = Some(child);
                }
                match wait_child(&slot) {
                    (_, true) => return Ok(None),
                    (Some(true), _) => {}
                    _ => return Err(format!("não foi possível ler {}", input.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())),
                }
                let data = std::fs::read(&jpg).map_err(|e| e.to_string())?;
                let (w, h, comps) = jpeg_info(&data).ok_or("imagem convertida inválida")?;
                pages.push(PdfImage { data, width: w, height: h, components: comps });
                emit(&app2, &JobEvent { progress: Some(((i + 1) as f64 / n as f64) * 0.95), ..base.clone() });
            }
            write_pdf(&pages, &output).map_err(|e| e.to_string())?;
            Ok(Some(()))
        })();
        let _ = std::fs::remove_dir_all(&tmp);
        let ev = match result {
            Ok(Some(())) => JobEvent { status: "done".into(), progress: Some(1.0), output: Some(output.to_string_lossy().to_string()), ..base.clone() },
            Ok(None) => JobEvent { status: "canceled".into(), ..base.clone() },
            Err(e) => {
                let _ = std::fs::remove_file(&output);
                JobEvent { status: "error".into(), error: Some(e), ..base.clone() }
            }
        };
        emit(&app2, &ev);
    });
    Ok(id)
}

pub struct PdfImage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub components: u8,
}

/// Largura, altura e nº de componentes de um JPEG (marcador SOF).
pub fn jpeg_info(b: &[u8]) -> Option<(u32, u32, u8)> {
    if b.len() < 4 || b[0] != 0xFF || b[1] != 0xD8 {
        return None;
    }
    let mut i = 2;
    while i + 9 < b.len() {
        if b[i] != 0xFF {
            i += 1;
            continue;
        }
        let m = b[i + 1];
        if m == 0xFF || m == 0x01 || (0xD0..=0xD8).contains(&m) {
            i += if m == 0xFF { 1 } else { 2 };
            continue;
        }
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if matches!(m, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            let h = u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32;
            let w = u16::from_be_bytes([b[i + 7], b[i + 8]]) as u32;
            return (w > 0 && h > 0).then_some((w, h, b[i + 9]));
        }
        i += 2 + len;
    }
    None
}

/// PDF mínimo: uma página por imagem, no tamanho da imagem (96 ppp → pontos).
pub fn pdf_bytes(pages: &[PdfImage]) -> Vec<u8> {
    let mut out: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets: Vec<usize> = Vec::new();
    let n = pages.len();
    let total = 2 + 3 * n;
    let obj = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]| {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };
    obj(&mut out, &mut offsets, b"<< /Type /Catalog /Pages 2 0 R >>");
    let kids: Vec<String> = (0..n).map(|k| format!("{} 0 R", 3 + 3 * k)).collect();
    obj(&mut out, &mut offsets, format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")).as_bytes());
    for (k, p) in pages.iter().enumerate() {
        let (img, content) = (4 + 3 * k, 5 + 3 * k);
        let (w, h) = (p.width as f64 * 0.75, p.height as f64 * 0.75);
        obj(
            &mut out,
            &mut offsets,
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.2} {h:.2}] /Resources << /XObject << /Im0 {img} 0 R >> >> /Contents {content} 0 R >>").as_bytes(),
        );
        let cs = match p.components {
            1 => "/DeviceGray",
            4 => "/DeviceCMYK",
            _ => "/DeviceRGB",
        };
        let mut body = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace {cs} /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            p.width,
            p.height,
            p.data.len()
        )
        .into_bytes();
        body.extend_from_slice(&p.data);
        body.extend_from_slice(b"\nendstream");
        obj(&mut out, &mut offsets, &body);
        let draw = format!("q {w:.2} 0 0 {h:.2} 0 0 cm /Im0 Do Q");
        obj(&mut out, &mut offsets, format!("<< /Length {} >>\nstream\n{draw}\nendstream", draw.len()).as_bytes());
    }
    debug_assert_eq!(offsets.len(), total);
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", total + 1).as_bytes());
    for o in &offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", total + 1).as_bytes());
    out
}

fn write_pdf(pages: &[PdfImage], output: &Path) -> std::io::Result<()> {
    let part = output.with_extension("pdf.part");
    std::fs::write(&part, pdf_bytes(pages))?;
    std::fs::rename(&part, output)
}

/// Nome de saída de uma página: "contrato p2 (VANTA).png". PDF de uma página fica sem o "p1".
fn page_output(input: &Path, page: u32, pages: u32, target: &str, dir: Option<&Path>) -> PathBuf {
    if pages <= 1 {
        return output_path(input, target, dir);
    }
    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "pdf".into());
    let named = input.with_file_name(format!("{stem} p{page}.{target}"));
    output_path(&named, target, dir.or(input.parent()))
}

fn pdf_to_images_job(app: &AppHandle, tools: &Tools, input: PathBuf, target: String, out_dir: Option<PathBuf>) -> AppResult<String> {
    let ffmpeg = ffmpeg_path(app)?;
    let id = tools.next_id("convert");
    let name = input.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let stop = Arc::new(AtomicBool::new(false));
    tools.stops.lock().map_err(|_| AppError::io("lock"))?.insert(id.clone(), stop.clone());
    let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    tools.jobs.lock().map_err(|_| AppError::io("lock"))?.insert(id.clone(), slot.clone());
    let base = JobEvent { id: id.clone(), kind: "convert".into(), status: "running".into(), progress: None, title: format!("{name} → {}", target.to_uppercase()), output: None, error: None, thumb: None };
    emit(app, &base);
    let app2 = app.clone();
    let tmp = std::env::temp_dir().join(format!("vanta-{id}"));
    std::thread::spawn(move || {
        let mut made: Vec<PathBuf> = Vec::new();
        let result = (|| -> Result<Option<()>, String> {
            let doc = pdf::Doc::open(&input, ffmpeg.parent().unwrap_or(Path::new(".")))?;
            let pages = doc.pages()?;
            if pages == 0 {
                return Err("o PDF não tem páginas".into());
            }
            std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
            for i in 0..pages {
                if stop.load(Ordering::SeqCst) {
                    return Ok(None);
                }
                let png = doc.render(i, None).map_err(|e| format!("falha ao desenhar a página {}: {e}", i + 1))?;
                let out = page_output(&input, i + 1, pages, &target, out_dir.as_deref());
                if target == "png" {
                    std::fs::write(&out, &png).map_err(|e| e.to_string())?;
                } else {
                    let src = tmp.join(format!("{i}.png"));
                    std::fs::write(&src, &png).map_err(|e| e.to_string())?;
                    let args = ffmpeg_args("image", &target).ok_or("formato inválido")?;
                    let mut cmd = Command::new(&ffmpeg);
                    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]).arg(&src).args(&args).arg(&out).stdout(Stdio::null()).stderr(Stdio::null());
                    let child = hidden(&mut cmd).spawn().map_err(|e| format!("não foi possível iniciar o conversor: {e}"))?;
                    if let Ok(mut g) = slot.lock() {
                        *g = Some(child);
                    }
                    match wait_child(&slot) {
                        (_, true) => return Ok(None),
                        (Some(true), _) => {}
                        _ => return Err(format!("falha ao gravar a página {}", i + 1)),
                    }
                }
                made.push(out);
                emit(&app2, &JobEvent { progress: Some((i + 1) as f64 / pages as f64 * 0.99), ..base.clone() });
            }
            Ok(Some(()))
        })();
        let _ = std::fs::remove_dir_all(&tmp);
        let ev = match result {
            // várias páginas: "abrir" leva à primeira; "mostrar na pasta" mostra todas juntas
            Ok(Some(())) => JobEvent { status: "done".into(), progress: Some(1.0), output: made.first().map(|p| p.to_string_lossy().to_string()), ..base.clone() },
            Ok(None) => {
                made.iter().for_each(|p| drop(std::fs::remove_file(p)));
                JobEvent { status: "canceled".into(), ..base.clone() }
            }
            Err(e) => {
                made.iter().for_each(|p| drop(std::fs::remove_file(p)));
                JobEvent { status: "error".into(), error: Some(e), ..base.clone() }
            }
        };
        emit(&app2, &ev);
    });
    Ok(id)
}

#[tauri::command]
pub fn job_cancel(tools: State<'_, Tools>, id: String) -> AppResult<()> {
    if let Some(flag) = tools.stops.lock().map_err(|_| AppError::io("lock"))?.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    let slot = tools.jobs.lock().map_err(|_| AppError::io("lock"))?.get(&id).cloned();
    if let Some(slot) = slot {
        if let Ok(mut g) = slot.lock() {
            if let Some(mut child) = g.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ downloader

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloaderStatus {
    pub installed: bool,
    /** O gallery-dl (imagens do Pinterest) está instalado. */
    pub images: bool,
    /** A instalação automática está em andamento. */
    pub installing: bool,
    pub version: Option<String>,
    pub folder: String,
}

fn downloads_dir(app: &AppHandle, custom: Option<String>) -> AppResult<PathBuf> {
    if let Some(c) = custom.filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        if p.is_absolute() && p.is_dir() {
            return Ok(p);
        }
    }
    let d = app.path().download_dir().map_err(|e| AppError::io(e.to_string()))?.join("VANTA");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

#[tauri::command]
pub fn downloader_status(app: AppHandle, folder: Option<String>) -> AppResult<DownloaderStatus> {
    let exe = ytdlp_path(&app)?;
    let version = if exe.is_file() {
        hidden(Command::new(&exe).arg("--version"))
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        None
    };
    Ok(DownloaderStatus {
        installed: version.is_some(),
        images: gallerydl_path(&app).map(|p| p.is_file()).unwrap_or(false),
        installing: AUTO_INSTALLING.load(Ordering::SeqCst),
        version,
        folder: downloads_dir(&app, folder)?.to_string_lossy().to_string(),
    })
}

fn sha256_file(path: &Path) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn curl(url: &str, out: &Path) -> AppResult<()> {
    let st = hidden(Command::new(CURL).args(["-L", "--fail", "--silent", "--show-error", "--max-time", "300", "-o"]).arg(out).arg(url))
        .status()
        .map_err(|e| AppError::unavailable(format!("curl indisponível: {e}")))?;
    if st.success() {
        Ok(())
    } else {
        Err(AppError::unavailable("não foi possível baixar o componente (sem internet?)"))
    }
}

/// Linux e macOS: o arquivo baixado só roda com permissão de execução.
fn make_executable(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
    }
    let _ = path;
    Ok(())
}

/// Uma instalação por vez (a automática e o botão podem coincidir).
static INSTALL_LOCK: Mutex<()> = Mutex::new(());
static AUTO_INSTALLING: AtomicBool = AtomicBool::new(false);

/// Baixa o yt-dlp do release oficial e confere o SHA-256 antes de aceitar.
fn install_ytdlp(exe: &Path) -> AppResult<String> {
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if exe.is_file() {
        return Ok(String::new());
    }
    {
        let dir = exe.parent().ok_or_else(|| AppError::io("pasta"))?.to_path_buf();
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join("yt-dlp.download");
        let sums = dir.join("SHA2-256SUMS.download");
        curl(&format!("{YTDLP_BASE}/{YTDLP_ASSET}"), &tmp)?;
        curl(&format!("{YTDLP_BASE}/SHA2-256SUMS"), &sums)?;
        let expected = std::fs::read_to_string(&sums)?
            .lines()
            .find_map(|l| {
                let mut it = l.split_whitespace();
                let hash = it.next()?;
                (it.next()? == YTDLP_ASSET).then(|| hash.to_ascii_lowercase())
            })
            .ok_or_else(|| AppError::invalid("lista de verificação do yt-dlp sem o arquivo esperado"))?;
        let got = sha256_file(&tmp)?;
        let _ = std::fs::remove_file(&sums);
        if got != expected {
            let _ = std::fs::remove_file(&tmp);
            return Err(AppError::invalid("o arquivo baixado não confere com o hash oficial; descartado"));
        }
        std::fs::rename(&tmp, exe)?;
        make_executable(exe)?;
        log::info!(target: "tools", "yt-dlp instalado e verificado ({got})");
        Ok(got)
    }
}

/// Baixa o gallery-dl fixado e confere o SHA-256 fixado.
fn install_gallerydl(exe: &Path) -> AppResult<String> {
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if exe.is_file() {
        return Ok(String::new());
    }
    let Some((asset, sha256)) = GALLERYDL else {
        return Err(AppError::unavailable("no macOS, as galerias de imagens usam o gallery-dl do Homebrew: brew install gallery-dl"));
    };
    let dir = exe.parent().ok_or_else(|| AppError::io("pasta"))?.to_path_buf();
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join("gallery-dl.download");
    curl(&format!("{GALLERYDL_BASE}/{asset}"), &tmp)?;
    let got = sha256_file(&tmp)?;
    if got != sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::invalid("o gallery-dl baixado não confere com o hash oficial; descartado"));
    }
    std::fs::rename(&tmp, exe)?;
    make_executable(exe)?;
    log::info!(target: "tools", "gallery-dl instalado e verificado ({got})");
    Ok(got)
}

#[tauri::command]
pub async fn downloader_install(app: AppHandle) -> AppResult<String> {
    let exe = ytdlp_path(&app)?;
    let gdl = gallerydl_path(&app)?;
    let r = tauri::async_runtime::spawn_blocking(move || {
        let r = install_ytdlp(&exe);
        if let Err(e) = install_gallerydl(&gdl) {
            log::warn!(target: "tools", "gallery-dl: {e}");
        }
        r
    })
    .await
    .map_err(|e| AppError::io(e.to_string()))?;
    let _ = app.emit("tools://downloader", ());
    r
}

/// Logo depois de instalado, o VANTA busca o yt-dlp sozinho, em segundo plano — o downloader já
/// está pronto quando a pessoa abre. Sem internet, tenta de novo mais tarde (30 s, 2 min, 10 min).
pub fn start_auto_install(app: &AppHandle) {
    let (Ok(exe), Ok(gdl)) = (ytdlp_path(app), gallerydl_path(app)) else { return };
    if exe.is_file() && gdl.is_file() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        AUTO_INSTALLING.store(true, Ordering::SeqCst);
        let _ = app.emit("tools://downloader", ());
        for (i, wait) in [0u64, 30, 120, 600].into_iter().enumerate() {
            std::thread::sleep(Duration::from_secs(wait));
            let a = install_ytdlp(&exe);
            let b = install_gallerydl(&gdl);
            match (a, b) {
                (Ok(_), Ok(_)) => break,
                (a, b) => log::warn!(target: "tools", "instalação automática, tentativa {}: yt-dlp {:?} · gallery-dl {:?}", i + 1, a.err(), b.err()),
            }
        }
        AUTO_INSTALLING.store(false, Ordering::SeqCst);
        let _ = app.emit("tools://downloader", ());
    });
}

/// Baixa um vídeo (MP4) ou só o áudio (MP3) de um link.
#[tauri::command]
pub fn download_start(app: AppHandle, tools: State<'_, Tools>, url: String, mode: String, folder: Option<String>) -> AppResult<String> {
    let url = url.trim().to_string();
    if url.len() > 2048 || !url.starts_with("https://") || url.contains(char::is_whitespace) {
        return Err(AppError::invalid("cole um link https válido"));
    }
    if is_gallery_link(&url) {
        if mode != "jpg" && mode != "png" {
            return Err(AppError::invalid("modo inválido para imagens"));
        }
        return gallery_job(&app, &tools, url, mode, folder);
    }
    let exe = ytdlp_path(&app)?;
    if !exe.is_file() {
        return Err(AppError::new("not_installed", "o componente de download ainda não foi instalado"));
    }
    let ffmpeg = ffmpeg_path(&app)?;
    let ffmpeg_thumb_path = ffmpeg.clone();
    let dir = downloads_dir(&app, folder)?;
    let mut cmd = Command::new(exe);
    // Num pipe, o yt-dlp escreve no código de página do Windows (cp1252); só `--encoding utf-8`
    // muda isso de fato (medido: as variáveis de ambiente do Python sozinhas não bastam).
    cmd.stdin(Stdio::null());
    cmd.args(["--encoding", "utf-8", "--newline", "--progress", "--no-playlist", "--no-mtime", "--restrict-filenames", "--windows-filenames"])
        .arg("--ffmpeg-location")
        .arg(ffmpeg.parent().unwrap_or(Path::new(".")))
        .arg("-P")
        .arg(&dir)
        .args(["-o", "%(title).120B [%(id)s].%(ext)s", "--print", "before_dl:VANTA_TITLE %(title)s", "--print", "before_dl:VANTA_THUMB %(thumbnail)s", "--print", "after_move:VANTA_FILE %(filepath)s"]);
    match mode.as_str() {
        "audio" => {
            cmd.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
        }
        "video" => {
            cmd.args(["-f", "bv*+ba/b", "-S", "vcodec:h264,res,acodec:m4a", "--merge-output-format", "mp4"]);
        }
        _ => return Err(AppError::invalid("modo inválido")),
    }
    cmd.arg("--").arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = hidden(&mut cmd).spawn().map_err(|e| AppError::io(format!("não foi possível iniciar o download: {e}")))?;
    let id = tools.next_id("download");
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let slot = Arc::new(Mutex::new(Some(child)));
    tools.jobs.lock().map_err(|_| AppError::io("lock"))?.insert(id.clone(), slot.clone());
    let base = JobEvent { id: id.clone(), kind: "download".into(), status: "running".into(), progress: None, title: url.clone(), output: None, error: None, thumb: None };
    emit(&app, &base);

    let tail = Arc::new(Mutex::new(String::new()));
    if let Some(err) = stderr {
        let tl = tail.clone();
        std::thread::spawn(move || {
            for line in lossy_lines(err) {
                if line.contains("ERROR") {
                    if let Ok(mut t) = tl.lock() {
                        *t = line.replace("ERROR: ", "").chars().take(300).collect();
                    }
                }
            }
        });
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut ev = base.clone();
        let mut last = Instant::now() - Duration::from_secs(1);
        if let Some(out) = stdout {
            for line in lossy_lines(out) {
                if let Some(t) = line.strip_prefix("VANTA_TITLE ") {
                    ev.title = t.chars().take(200).collect();
                    emit(&app2, &ev);
                } else if let Some(u) = line.strip_prefix("VANTA_THUMB ") {
                    if ev.thumb.is_none() {
                        ev.thumb = fetch_thumb(u, &std::env::temp_dir().join(format!("vanta-thumb-{}", ev.id)));
                        if ev.thumb.is_some() {
                            emit(&app2, &ev);
                        }
                    }
                } else if let Some(f) = line.strip_prefix("VANTA_FILE ") {
                    ev.output = Some(f.trim().to_string());
                } else if let Some(p) = parse_ytdlp_percent(&line) {
                    // Vídeo + áudio são dois downloads: a barra não volta para trás.
                    let p = p.max(ev.progress.unwrap_or(0.0)).min(0.99);
                    ev.progress = Some(p);
                    if last.elapsed() > Duration::from_millis(250) {
                        last = Instant::now();
                        emit(&app2, &ev);
                    }
                }
            }
        }
        let (ok, canceled) = wait_child(&slot);
        // sem capa remota: um quadro do próprio arquivo baixado
        if ok == Some(true) && ev.thumb.is_none() {
            if let Some(out) = ev.output.as_deref() {
                ev.thumb = thumb_for(&ffmpeg_thumb_path, Path::new(out));
            }
        }
        let done = match ok {
            Some(true) => JobEvent { status: "done".into(), progress: Some(1.0), ..ev },
            _ if canceled => JobEvent { status: "canceled".into(), ..ev },
            _ => {
                let detail = tail.lock().map(|t| t.clone()).unwrap_or_default();
                JobEvent { status: "error".into(), error: Some(friendly_error(&detail).unwrap_or(if detail.is_empty() { "o download falhou".into() } else { detail })), ..ev }
            }
        };
        emit(&app2, &done);
    });
    Ok(id)
}

/// Imagens do Pinterest (um pin ou uma pasta inteira) pelo gallery-dl. Vídeos da pasta ficam de
/// fora: o pedido é imagem. Em PNG, cada imagem é convertida pelo ffmpeg depois de baixada.
fn gallery_job(app: &AppHandle, tools: &Tools, url: String, mode: String, folder: Option<String>) -> AppResult<String> {
    let exe = gallerydl_path(app)?;
    if !exe.is_file() {
        return Err(AppError::new("not_installed", "o componente de imagens ainda não foi instalado"));
    }
    let ffmpeg = ffmpeg_path(app)?;
    let dir = downloads_dir(app, folder)?;
    let site = video_site(&url).unwrap_or("Pinterest");
    let mut cmd = Command::new(&exe);
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .args(["--no-mtime", "--filter", if site == "Instagram" { "extension in ('jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4')" } else { "extension in ('jpg', 'jpeg', 'png', 'webp', 'gif')" }, "-d"])
        .arg(&dir)
        .arg("--")
        .arg(&url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hidden(&mut cmd).spawn().map_err(|e| AppError::io(format!("não foi possível iniciar o download: {e}")))?;
    let id = tools.next_id("download");
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let slot = Arc::new(Mutex::new(Some(child)));
    tools.jobs.lock().map_err(|_| AppError::io("lock"))?.insert(id.clone(), slot.clone());
    let base = JobEvent { id: id.clone(), kind: "download".into(), status: "running".into(), progress: None, title: format!("{site} · {url}"), output: None, error: None, thumb: None };
    emit(app, &base);
    let tail = Arc::new(Mutex::new(String::new()));
    if let Some(err) = stderr {
        let tl = tail.clone();
        std::thread::spawn(move || {
            for line in lossy_lines(err) {
                if line.contains("[error]") || line.contains("429") {
                    if let Ok(mut t) = tl.lock() {
                        *t = line.replace("[error]", "").trim().chars().take(300).collect();
                    }
                }
            }
        });
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut ev = base.clone();
        let mut files: Vec<PathBuf> = Vec::new();
        if let Some(out) = stdout {
            // o gallery-dl imprime o caminho de cada arquivo salvo ("# " = já existia, pulado)
            for line in lossy_lines(out) {
                let path = PathBuf::from(line.trim_start_matches("# ").trim());
                if !path.is_absolute() || !path.is_file() {
                    continue;
                }
                if ev.thumb.is_none() {
                    ev.thumb = thumb_for(&ffmpeg, &path);
                }
                files.push(path);
                ev.title = format!("{site} · {} {}", files.len(), if files.len() == 1 { "arquivo" } else { "arquivos" });
                ev.output = files.first().map(|p| p.to_string_lossy().to_string());
                emit(&app2, &ev);
            }
        }
        let (ok, canceled) = wait_child(&slot);
        if ok == Some(true) && mode == "png" {
            let n = files.len().max(1) as f64;
            for (i, f) in files.iter_mut().enumerate() {
                let ext = f.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
                if ext == "png" || ext == "gif" {
                    continue;
                }
                let png = f.with_extension("png");
                let mut c = Command::new(&ffmpeg);
                c.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]).arg(&*f).args(["-frames:v", "1"]).arg(&png).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
                if hidden(&mut c).status().map(|s| s.success()).unwrap_or(false) {
                    let _ = std::fs::remove_file(&*f);
                    *f = png;
                }
                emit(&app2, &JobEvent { progress: Some(((i + 1) as f64 / n).min(0.99)), ..ev.clone() });
            }
            ev.output = files.first().map(|p| p.to_string_lossy().to_string());
        }
        let done = match ok {
            Some(true) if files.is_empty() => JobEvent { status: "error".into(), error: Some("nenhuma imagem encontrada nesse link".into()), ..ev },
            Some(true) => JobEvent { status: "done".into(), progress: Some(1.0), ..ev },
            _ if canceled => JobEvent { status: "canceled".into(), ..ev },
            _ => {
                let detail = tail.lock().map(|t| t.clone()).unwrap_or_default();
                JobEvent { status: "error".into(), error: Some(friendly_error(&detail).unwrap_or(if detail.is_empty() { "o download falhou".into() } else { detail })), ..ev }
            }
        };
        emit(&app2, &done);
    });
    Ok(id)
}

// ------------------------------------------------------------------ link copiado

#[derive(Serialize, Clone)]
struct LinkEvent {
    url: String,
    site: String,
}

pub fn start_clipboard_watch(app: &AppHandle, tools: &Tools) {
    let flag = tools.watch.clone();
    let app = app.clone();
    std::thread::Builder::new()
        .name("vanta-clipboard".into())
        .spawn(move || {
            #[cfg(windows)]
            {
                use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
                let mut seq = unsafe { GetClipboardSequenceNumber() };
                loop {
                    std::thread::sleep(Duration::from_millis(700));
                    let now = unsafe { GetClipboardSequenceNumber() };
                    if now == seq {
                        continue;
                    }
                    seq = now;
                    if !flag.load(Ordering::Relaxed) {
                        continue;
                    }
                    if let Some(text) = read_clipboard_text() {
                        if let Some(site) = video_site(&text) {
                            let _ = app.emit_to(crate::island::ISLAND_LABEL, "tools://link", LinkEvent { url: text.trim().to_string(), site: site.into() });
                        }
                    }
                }
            }
            // Linux e macOS: sem contador de sequência, compara o texto (só textos curtos).
            #[cfg(not(windows))]
            {
                let read = |cb: &mut Option<arboard::Clipboard>| -> Option<String> {
                    if cb.is_none() {
                        *cb = arboard::Clipboard::new().ok();
                    }
                    cb.as_mut()?.get_text().ok().filter(|t| t.len() <= 8192)
                };
                let mut cb = None;
                let mut last = read(&mut cb);
                loop {
                    std::thread::sleep(Duration::from_millis(700));
                    let now = read(&mut cb);
                    if now == last {
                        continue;
                    }
                    last = now.clone();
                    if !flag.load(Ordering::Relaxed) {
                        continue;
                    }
                    if let Some(site) = now.as_deref().and_then(video_site) {
                        let url = now.unwrap_or_default().trim().to_string();
                        let _ = app.emit_to(crate::island::ISLAND_LABEL, "tools://link", LinkEvent { url, site: site.into() });
                    }
                }
            }
        })
        .expect("thread da área de transferência");
}

#[cfg(windows)]
fn read_clipboard_text() -> Option<String> {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;
    unsafe {
        if IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).is_err() {
            return None;
        }
        // Outro programa pode estar com a área de transferência aberta: tenta algumas vezes.
        let mut opened = false;
        for _ in 0..4 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        if !opened {
            return None;
        }
        let out = (|| {
            let h: HANDLE = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
            let g = HGLOBAL(h.0);
            let size = GlobalSize(g);
            // Só textos curtos interessam (um link); documentos inteiros são ignorados.
            if size == 0 || size > 8192 {
                return None;
            }
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return None;
            }
            let len = (0..size / 2).take_while(|i| *p.add(*i) != 0).count();
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            let _ = GlobalUnlock(g);
            Some(s)
        })();
        let _ = CloseClipboard();
        out
    }
}

#[tauri::command]
pub fn tools_set_watch(tools: State<'_, Tools>, enabled: bool) {
    tools.watch.store(enabled, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_targets() {
        assert_eq!(kind_of("jpeg"), "image");
        assert_eq!(kind_of("mkv"), "video");
        assert_eq!(kind_of("flac"), "audio");
        assert_eq!(kind_of("exe"), "other");
        assert!(ffmpeg_args("image", "mp3").is_none());
        assert!(ffmpeg_args("video", "gif").is_some());
        assert!(ffmpeg_args("audio", "mp4").is_none());
        assert!(ffmpeg_args("other", "png").is_none());
        // PDF não passa pelo ffmpeg direto: é montado pelo VANTA
        assert!(targets_for("image").contains(&"pdf"));
        assert!(ffmpeg_args("image", "pdf").is_none());
        // e o caminho de volta: PDF vira imagem (renderizado pelo Windows)
        assert_eq!(kind_of("pdf"), "pdf");
        assert_eq!(targets_for("pdf"), &["png", "jpg", "webp"]);
    }

    #[test]
    fn output_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("vanta-tools-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("foto.png");
        let first = output_path(&input, "jpg", None);
        assert_eq!(first.file_name().unwrap(), "foto (VANTA).jpg");
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(output_path(&input, "jpg", None).file_name().unwrap(), "foto (VANTA 2).jpg");
    }

    #[test]
    fn parses_progress() {
        assert_eq!(parse_duration_ms("  Duration: 00:01:02.50, start: 0.000000, bitrate"), Some(62_500.0));
        assert_eq!(parse_ytdlp_percent("[download]  42.3% of ~ 12.34MiB at 1.2MiB/s"), Some(0.423));
        assert_eq!(parse_ytdlp_percent("[info] nada"), None);
    }

    #[test]
    fn detects_only_video_links() {
        assert_eq!(video_site("https://www.youtube.com/watch?v=abc"), Some("YouTube"));
        assert_eq!(video_site("https://youtu.be/abc"), Some("YouTube"));
        assert_eq!(video_site("https://www.instagram.com/reel/xyz/"), Some("Instagram"));
        assert_eq!(video_site("https://www.tiktok.com/@a/video/123"), Some("TikTok"));
        assert_eq!(video_site("https://x.com/u/status/1"), Some("X"));
        assert_eq!(video_site("https://www.youtube.com/"), None);
        assert_eq!(video_site("http://youtube.com/watch?v=a"), None);
        assert_eq!(video_site("veja https://youtu.be/abc"), None);
        assert_eq!(video_site("https://example.com/video.mp4"), None);
    }

    fn fake_jpeg(w: u16, h: u16) -> Vec<u8> {
        let mut b = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08];
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&[0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]);
        b
    }

    #[test]
    fn jpeg_dimensions_from_sof() {
        assert_eq!(jpeg_info(&fake_jpeg(640, 480)), Some((640, 480, 3)));
        assert_eq!(jpeg_info(b"not a jpeg"), None);
    }

    #[test]
    fn pdf_has_one_page_per_image_and_valid_xref() {
        let pages: Vec<PdfImage> = [(640u16, 480u16), (100, 200)]
            .iter()
            .map(|&(w, h)| PdfImage { data: fake_jpeg(w, h), width: w as u32, height: h as u32, components: 3 })
            .collect();
        let pdf = pdf_bytes(&pages);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Count 2"));
        assert!(text.contains("/MediaBox [0 0 480.00 360.00]"));
        assert!(text.trim_end().ends_with("%%EOF"));
        // cada entrada do xref aponta para o início exato de "N 0 obj"
        let xref_at: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        // offsets são de bytes (o cabeçalho binário não é UTF-8): conferir sobre os bytes
        let table = String::from_utf8_lossy(&pdf[xref_at..]).to_string();
        assert!(table.starts_with("xref"));
        for (n, line) in table.lines().skip(3).take(8).enumerate() {
            let off: usize = line[..10].parse().unwrap();
            assert!(pdf[off..].starts_with(format!("{} 0 obj", n + 1).as_bytes()), "objeto {}", n + 1);
        }
    }

    /// Ida e volta real: imagens → PDF (nosso gerador) → páginas desenhadas pelo Windows.
    /// Precisa de um JPEG de verdade: `VANTA_TEST_JPEG=caminho cargo test -- --ignored pdf_roundtrip`.
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn pdf_roundtrip_with_windows_renderer() {
        let jpg = std::fs::read(std::env::var("VANTA_TEST_JPEG").expect("VANTA_TEST_JPEG")).unwrap();
        let (w, h, c) = jpeg_info(&jpg).unwrap();
        let page = || PdfImage { data: jpg.clone(), width: w, height: h, components: c };
        let path = std::env::temp_dir().join("vanta-roundtrip.pdf");
        write_pdf(&[page(), page()], &path).unwrap();
        let doc = pdf::Doc::open(&path, Path::new(".")).unwrap();
        assert_eq!(doc.pages().unwrap(), 2);
        let png = doc.render(1, None).unwrap();
        assert_eq!(&png[..4], &[0x89, b'P', b'N', b'G']);
        let out = std::env::temp_dir().join("vanta-roundtrip-p2.png");
        std::fs::write(&out, &png).unwrap();
        println!("render ok: {} bytes -> {}", png.len(), out.display());
    }

    #[test]
    fn lossy_lines_keeps_reading_past_invalid_utf8() {
        // "Matu\xEA" em cp1252: o leitor antigo parava aqui e fechava o pipe
        let data: &[u8] = b"VANTA_TITLE Matu\xEA\r\n[download]  50.0% of 4MiB\nVANTA_FILE x.mp3\n";
        let lines: Vec<String> = lossy_lines(data).collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("VANTA_TITLE Matu"));
        assert_eq!(parse_ytdlp_percent(&lines[1]), Some(0.5));
        assert_eq!(lines[2], "VANTA_FILE x.mp3");
    }

    #[test]
    fn thumbnails_only_accept_real_images() {
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_mime(b"<svg onload=alert(1)>"), None);
        assert!(data_url(b"<html>").is_none());
        assert!(data_url(&[0x89, b'P', b'N', b'G', 0, 0]).unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn pinterest_links_go_to_images() {
        assert!(is_pinterest("https://br.pinterest.com/pin/123456789/"));
        assert!(is_pinterest("https://www.pinterest.com/fulana/papeis-de-parede/"));
        assert!(is_pinterest("https://in.pinterest.com/shruthi_alekhya/aesthetic-wallpaper/"));
        assert!(is_pinterest("https://pin.it/abc123"));
        assert!(!is_pinterest("https://www.pinterest.com/"));
        assert!(!is_pinterest("https://pinterest.com.evil.example/pin/1"));
        assert!(!is_pinterest("https://www.youtube.com/watch?v=x"));
    }

    #[test]
    fn instagram_picks_the_right_tool() {
        assert!(is_gallery_link("https://www.instagram.com/p/C1a2b3c4d5/"));
        assert!(is_gallery_link("https://www.instagram.com/fulano/p/C1a2b3c4d5/"));
        assert!(!is_gallery_link("https://www.instagram.com/reel/C1a2b3c4d5/"));
        assert!(!is_gallery_link("https://www.instagram.com/reels/C1a2b3c4d5/"));
        assert_eq!(video_site("https://www.instagram.com/reel/C1a2b3c4d5/"), Some("Instagram"));
        assert!(friendly_error("ERROR: [Instagram] C1: Requested content is not available, rate-limit reached or login required").is_some());
        assert!(friendly_error("ERROR: unable to download").is_none());
    }
}

