//! Letras online via LRCLIB (https://lrclib.net), API pública e gratuita, sem chave.
//!
//! Fluxo: `/api/get` com artista, faixa, álbum e duração (correspondência exata do LRCLIB);
//! se não houver, `/api/search` e escolhe o resultado de duração mais próxima, preferindo
//! letra sincronizada. O LRCLIB responde 503 sob carga: há uma nova tentativa com espera.
//! O HTTP é o do próprio Windows (`Windows.Web.Http`), sem dependência extra.
//!
//! Só título, artista, álbum e duração da faixa saem do computador — e só com a opção ligada.
//! Resultados (inclusive "sem letra") ficam em cache em memória e em disco.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::alarms::now_ms;
use crate::error::{AppError, AppResult};

const BASE: &str = "https://lrclib.net/api";
const MISS_TTL_MS: i64 = 3 * 24 * 3600 * 1000;
const MEMORY_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    /// "synced" | "plain" | "instrumental" | "none"
    pub status: String,
    pub text: String,
    pub source: String,
    pub fetched_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

#[derive(Default)]
pub struct Lyrics {
    memory: Mutex<HashMap<String, LyricsResult>>,
}

/// Codificação de componente de URL (RFC 3986, caracteres não reservados passam).
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Remove ruído comum de títulos: "(Official Video)", "[Remastered]", " - Ao Vivo", "feat.".
pub fn clean_title(title: &str) -> String {
    let mut t = String::new();
    let mut depth = 0i32;
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => t.push(c),
            _ => {}
        }
    }
    let lower = t.to_lowercase();
    let cut = [" - ", " – ", " feat.", " ft.", " feat "]
        .iter()
        .filter_map(|p| lower.find(p))
        .min()
        .unwrap_or(t.len());
    t[..cut.min(t.len())].trim().to_string()
}

/// Primeiro artista de "A, B & C feat. D".
pub fn primary_artist(artist: &str) -> String {
    let lower = artist.to_lowercase();
    let cut = [",", " & ", " x ", " feat", " ft.", ";", " e "]
        .iter()
        .filter_map(|p| lower.find(p))
        .min()
        .unwrap_or(artist.len());
    artist[..cut].trim().to_string()
}

/// Vídeos costumam vir como "Artista - Música" no título e sem artista.
pub fn split_video_title(artist: &str, title: &str) -> (String, String) {
    if artist.trim().is_empty() {
        if let Some((a, t)) = title.split_once(" - ").or_else(|| title.split_once(" – ")) {
            return (a.trim().to_string(), t.trim().to_string());
        }
    }
    (artist.trim().to_string(), title.trim().to_string())
}

fn to_result(r: &Record) -> LyricsResult {
    let synced = r.synced_lyrics.as_deref().unwrap_or("").trim();
    let plain = r.plain_lyrics.as_deref().unwrap_or("").trim();
    let (status, text) = if r.instrumental {
        ("instrumental", "")
    } else if !synced.is_empty() {
        ("synced", synced)
    } else if !plain.is_empty() {
        ("plain", plain)
    } else {
        ("none", "")
    };
    LyricsResult { status: status.into(), text: text.to_string(), source: "LRCLIB".into(), fetched_at_ms: now_ms() }
}

/// Melhor resultado da busca: duração mais próxima (até 4 s), preferindo sincronizada.
fn pick(records: &[Record], duration_s: Option<f64>) -> Option<&Record> {
    let score = |r: &Record| {
        let has_text = r.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty())
            || r.plain_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty());
        if !has_text && !r.instrumental {
            return None;
        }
        let diff = match (duration_s, r.duration) {
            (Some(d), Some(rd)) => (d - rd).abs(),
            _ => 0.0,
        };
        if diff > 4.0 {
            return None;
        }
        let synced_bonus = if r.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty()) { 0.0 } else { 2.0 };
        Some(diff + synced_bonus)
    };
    records
        .iter()
        .filter_map(|r| score(r).map(|s| (s, r)))
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, r)| r)
}

#[cfg(windows)]
fn http_get(url: &str) -> AppResult<(u16, String)> {
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    use windows::Web::Http::HttpClient;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let client = HttpClient::new()?;
    let ua = format!("VANTA/{} (Dynamic Island para Windows)", env!("CARGO_PKG_VERSION"));
    let _ = client.DefaultRequestHeaders()?.UserAgent()?.TryParseAdd(&HSTRING::from(ua));
    let resp = client.GetAsync(&Uri::CreateUri(&HSTRING::from(url))?)?.join()?;
    let status = resp.StatusCode()?.0 as u16;
    let body = resp.Content()?.ReadAsStringAsync()?.join()?.to_string();
    Ok((status, body))
}

#[cfg(not(windows))]
fn http_get(_url: &str) -> AppResult<(u16, String)> {
    Err(AppError::unavailable("sem HTTP nesta plataforma"))
}

/// GET com tempo limite e uma nova tentativa para 429/503.
fn get(url: &str) -> AppResult<(u16, String)> {
    for attempt in 0..3 {
        let u = url.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(http_get(&u));
        });
        let r = rx.recv_timeout(Duration::from_secs(12)).unwrap_or_else(|_| Err(AppError::unavailable("tempo esgotado")));
        match r {
            Ok((s, _)) if (s == 503 || s == 429) && attempt < 2 => std::thread::sleep(Duration::from_millis(900 * (attempt + 1))),
            other => return other,
        }
    }
    Err(AppError::unavailable("LRCLIB indisponível"))
}

fn fetch(artist: &str, title: &str, album: &str, duration_s: Option<f64>) -> AppResult<LyricsResult> {
    let (artist, title) = split_video_title(artist, title);
    if let Some(d) = duration_s {
        let url = format!(
            "{BASE}/get?artist_name={}&track_name={}&album_name={}&duration={}",
            encode(&artist),
            encode(&title),
            encode(album),
            d.round() as i64
        );
        let (status, body) = get(&url)?;
        if status == 200 {
            if let Ok(rec) = serde_json::from_str::<Record>(&body) {
                let r = to_result(&rec);
                if r.status != "none" {
                    return Ok(r);
                }
            }
        } else if status != 404 {
            return Err(AppError::unavailable(format!("LRCLIB respondeu {status}")));
        }
    }
    // Busca tolerante: título limpo e artista principal.
    let queries = [(clean_title(&title), primary_artist(&artist)), (title.clone(), artist.clone())];
    for (t, a) in queries.iter() {
        if t.is_empty() {
            continue;
        }
        let url = if a.is_empty() {
            format!("{BASE}/search?track_name={}", encode(t))
        } else {
            format!("{BASE}/search?track_name={}&artist_name={}", encode(t), encode(a))
        };
        let (status, body) = get(&url)?;
        if status != 200 {
            return Err(AppError::unavailable(format!("LRCLIB respondeu {status}")));
        }
        let records: Vec<Record> = serde_json::from_str(&body).unwrap_or_default();
        if let Some(best) = pick(&records, duration_s) {
            return Ok(to_result(best));
        }
    }
    Ok(LyricsResult { status: "none".into(), text: String::new(), source: "LRCLIB".into(), fetched_at_ms: now_ms() })
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_cache_dir().ok()?.join("lyrics");
    std::fs::create_dir_all(&d).ok()?;
    Some(d)
}

fn cache_key(artist: &str, title: &str, album: &str, duration_s: Option<f64>) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (artist.to_lowercase(), title.to_lowercase(), album.to_lowercase(), duration_s.map(|d| d.round() as i64)).hash(&mut h);
    format!("{:016x}", h.finish())
}

#[tauri::command]
pub async fn lyrics_lookup(
    app: AppHandle,
    lyrics: State<'_, Lyrics>,
    artist: String,
    title: String,
    album: String,
    duration_ms: Option<f64>,
) -> AppResult<LyricsResult> {
    if title.trim().is_empty() || title.len() > 400 || artist.len() > 400 || album.len() > 400 {
        return Ok(LyricsResult { status: "none".into(), text: String::new(), source: String::new(), fetched_at_ms: now_ms() });
    }
    let duration_s = duration_ms.filter(|d| d.is_finite() && *d > 0.0 && *d < 4.0 * 3600.0 * 1000.0).map(|d| d / 1000.0);
    let key = cache_key(&artist, &title, &album, duration_s);
    if let Some(hit) = lyrics.memory.lock().ok().and_then(|m| m.get(&key).cloned()) {
        return Ok(hit);
    }
    let disk = cache_dir(&app).map(|d| d.join(format!("{key}.json")));
    if let Some(path) = &disk {
        if let Some(r) = std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<LyricsResult>(&b).ok()) {
            let fresh = r.status != "none" || now_ms() - r.fetched_at_ms < MISS_TTL_MS;
            if fresh {
                remember(&lyrics, key, r.clone());
                return Ok(r);
            }
        }
    }
    let result = tauri::async_runtime::spawn_blocking(move || fetch(&artist, &title, &album, duration_s))
        .await
        .map_err(|e| AppError::io(e.to_string()))??;
    if let Some(path) = disk {
        if let Ok(bytes) = serde_json::to_vec(&result) {
            let _ = std::fs::write(path, bytes);
        }
    }
    remember(&lyrics, key, result.clone());
    Ok(result)
}

fn remember(lyrics: &Lyrics, key: String, r: LyricsResult) {
    if let Ok(mut m) = lyrics.memory.lock() {
        if m.len() >= MEMORY_LIMIT {
            m.clear();
        }
        m.insert(key, r);
    }
}

#[tauri::command]
pub fn lyrics_clear_cache(app: AppHandle, lyrics: State<'_, Lyrics>) -> AppResult<()> {
    if let Ok(mut m) = lyrics.memory.lock() {
        m.clear();
    }
    if let Some(d) = cache_dir(&app) {
        let _ = std::fs::remove_dir_all(d);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query_components() {
        assert_eq!(encode("Matuê & Teto"), "Matu%C3%AA%20%26%20Teto");
        assert_eq!(encode("a-b_c.d~"), "a-b_c.d~");
    }

    #[test]
    fn cleans_noisy_titles_and_artists() {
        assert_eq!(clean_title("Paper Sky (Official Video) [4K]"), "Paper Sky");
        assert_eq!(clean_title("Song - Remastered 2011"), "Song");
        assert_eq!(clean_title("Track feat. Someone"), "Track");
        assert_eq!(primary_artist("Matuê, Teto & WIU"), "Matuê");
        assert_eq!(split_video_title("", "Artista - Música (Clipe)"), ("Artista".into(), "Música (Clipe)".into()));
        assert_eq!(split_video_title("Canal", "A - B"), ("Canal".into(), "A - B".into()));
    }

    #[test]
    fn picks_closest_duration_preferring_synced() {
        let rec = |d: f64, synced: bool, plain: bool| Record {
            duration: Some(d),
            instrumental: false,
            synced_lyrics: synced.then(|| "[00:01.00]x".to_string()),
            plain_lyrics: plain.then(|| "x".to_string()),
        };
        let list = vec![rec(200.0, false, true), rec(201.0, true, true), rec(260.0, true, true)];
        assert_eq!(pick(&list, Some(200.0)).and_then(|r| r.duration), Some(201.0));
        assert!(pick(&[rec(300.0, true, true)], Some(200.0)).is_none());
        assert_eq!(to_result(&list[0]).status, "plain");
        assert_eq!(to_result(&list[1]).status, "synced");
    }
}
