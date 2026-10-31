//! Ponte com a extensão de navegador (opcional).
//!
//! A integração nativa do Windows continua sendo o caminho principal; a extensão só
//! acrescenta o que o Windows não informa — o domínio da aba (YouTube, Netflix…) e o título
//! exato quando o site o expõe. A comunicação é local: Native Messaging até o host e um pipe
//! nomeado restrito ao usuário atual (ACL do dono + SYSTEM, clientes remotos recusados).
//! Nenhuma porta de rede é aberta.

pub mod host;
pub mod proto;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::alarms::now_ms;
use crate::error::{AppError, AppResult};
use proto::{AppMessage, BrowserTab, ExtMessage, HOST_NAME};

pub fn pipe_name() -> String {
    let user: String = std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" })
        .unwrap_or_else(|_| "user".into())
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(40)
        .collect();
    #[cfg(windows)]
    return format!(r"\\.\pipe\vanta-bridge-v1-{user}");
    // Linux: a pasta de execução do usuário (só ele acessa); macOS: a pasta temporária dele.
    #[cfg(not(windows))]
    {
        let dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        dir.join(format!("vanta-bridge-v1-{user}.sock")).to_string_lossy().into_owned()
    }
}

struct Conn {
    family: String,
    browser: String,
    version: String,
    connected_at_ms: i64,
    last_message_ms: i64,
    tx: UnboundedSender<String>,
}

#[derive(Default)]
struct Inner {
    conns: HashMap<u64, Conn>,
    tabs: HashMap<String, BrowserTab>,
    pongs: HashMap<u64, i64>,
    next_conn: u64,
    listening: bool,
    error: Option<String>,
}

pub struct Bridge {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnInfo {
    pub browser: String,
    pub family: String,
    pub version: String,
    pub connected_at_ms: i64,
    pub last_message_ms: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub registered: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub listening: bool,
    pub error: Option<String>,
    pub connections: Vec<ConnInfo>,
    pub browsers: Vec<BrowserInfo>,
    pub extension_id: String,
    pub extension_dir: Option<String>,
    pub host_name: String,
}

fn tabs_list(inner: &Inner) -> Vec<BrowserTab> {
    let mut v: Vec<BrowserTab> = inner.tabs.values().cloned().collect();
    v.sort_by_key(|t| std::cmp::Reverse(t.updated_at_ms));
    v
}

fn conn_list(inner: &Inner) -> Vec<ConnInfo> {
    inner
        .conns
        .values()
        .map(|c| ConnInfo {
            browser: c.browser.clone(),
            family: c.family.clone(),
            version: c.version.clone(),
            connected_at_ms: c.connected_at_ms,
            last_message_ms: c.last_message_ms,
        })
        .collect()
}

pub fn start(app: &AppHandle) -> Bridge {
    let inner = Arc::new(Mutex::new(Inner::default()));
    let (app2, inner2) = (app.clone(), inner.clone());
    tauri::async_runtime::spawn(async move { server::serve(app2, inner2).await });
    Bridge { inner }
}

fn emit_tabs(app: &AppHandle, inner: &Inner) {
    let _ = app.emit("bridge://tabs", tabs_list(inner));
}

fn handle_line(app: &AppHandle, inner: &Arc<Mutex<Inner>>, conn: u64, line: &[u8]) {
    let Ok(mut g) = inner.lock() else { return };
    let now = now_ms();
    if let Some(c) = g.conns.get_mut(&conn) {
        c.last_message_ms = now;
    }
    // Primeira linha interna do host: qual família de navegador abriu a porta.
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(line) {
        if v.get("type").and_then(|t| t.as_str()) == Some("_family") {
            if let (Some(f), Some(c)) = (v.get("family").and_then(|f| f.as_str()), g.conns.get_mut(&conn)) {
                c.family = if f == "firefox" { "firefox".into() } else { "chromium".into() };
            }
            return;
        }
    }
    let msg = match serde_json::from_slice::<ExtMessage>(line) {
        Ok(m) => m,
        Err(e) => {
            log::debug!(target: "bridge", "mensagem descartada: {e}");
            return;
        }
    };
    match msg {
        ExtMessage::Hello { browser, version } => {
            if let Some(c) = g.conns.get_mut(&conn) {
                c.browser = proto::sanitize_browser(&browser);
                c.version = version.chars().filter(|ch| ch.is_ascii_digit() || *ch == '.').take(16).collect();
            }
            log::info!(target: "bridge", "extensão conectada ({browser})");
            let list = conn_list(&g);
            let _ = app.emit("bridge://connections", list);
        }
        ExtMessage::Media(report) => {
            let browser = g.conns.get(&conn).map(|c| c.browser.clone()).unwrap_or_else(|| "browser".into());
            if let Some(tab) = proto::validate_tab(report, &browser, conn, now) {
                g.tabs.insert(tab.key.clone(), tab);
                // Abas pausadas há muito tempo deixam de ser relevantes.
                g.tabs.retain(|_, t| t.playing || now - t.updated_at_ms < 10 * 60 * 1000);
                if g.tabs.len() > 32 {
                    let mut keys: Vec<(String, i64)> = g.tabs.iter().map(|(k, t)| (k.clone(), t.updated_at_ms)).collect();
                    keys.sort_by_key(|(_, t)| *t);
                    for (k, _) in keys.into_iter().take(g.tabs.len() - 32) {
                        g.tabs.remove(&k);
                    }
                }
                emit_tabs(app, &g);
            }
        }
        ExtMessage::Gone { tab_id } => {
            let before = g.tabs.len();
            g.tabs.retain(|_, t| !(t.tab_id == tab_id && t.key.split(':').nth(1) == Some(&conn.to_string())));
            if g.tabs.len() != before {
                emit_tabs(app, &g);
            }
        }
        ExtMessage::Pong { nonce } => {
            g.pongs.insert(nonce, now);
        }
    }
}

mod server {
    use super::*;
    use tokio::io::{AsyncRead, AsyncWrite};
    #[cfg(windows)]
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    #[cfg(windows)]
    use windows::core::w;
    #[cfg(windows)]
    use windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    #[cfg(windows)]
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

    /// Linux e macOS: socket Unix com permissão 0600 (só o próprio usuário conecta).
    #[cfg(unix)]
    pub async fn serve(app: AppHandle, inner: Arc<Mutex<Inner>>) {
        use std::os::unix::fs::PermissionsExt;
        use tokio::net::UnixListener;
        let path = pipe_name();
        loop {
            // Um socket que sobrou de uma execução que caiu impediria o bind.
            let _ = std::fs::remove_file(&path);
            match UnixListener::bind(&path) {
                Ok(listener) => {
                    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
                    if let Ok(mut g) = inner.lock() {
                        g.listening = true;
                        g.error = None;
                    }
                    log::info!(target: "bridge", "ouvindo em {path}");
                    loop {
                        match listener.accept().await {
                            Ok((stream, _)) => {
                                tauri::async_runtime::spawn(handle(app.clone(), inner.clone(), stream));
                            }
                            Err(e) => {
                                log::warn!(target: "bridge", "falha ao aceitar conexão: {e}");
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!(target: "bridge", "socket {path} indisponível: {e}");
                    if let Ok(mut g) = inner.lock() {
                        g.listening = false;
                        g.error = Some(e.to_string());
                    }
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
            }
        }
    }

    /// DACL: só o dono do pipe (o usuário que rodou o VANTA) e o SYSTEM. Sem "Everyone".
    #[cfg(windows)]
    fn security_attributes() -> Option<&'static mut SECURITY_ATTRIBUTES> {
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(w!("D:P(A;;GA;;;OW)(A;;GA;;;SY)"), SDDL_REVISION_1, &mut sd, None)
                .ok()?;
        }
        // Vive enquanto o processo viver: um único descritor para todas as instâncias.
        Some(Box::leak(Box::new(SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.0,
            bInheritHandle: false.into(),
        })))
    }

    /// `sa` é o endereço do SECURITY_ATTRIBUTES estático (usize para a future ser `Send`).
    #[cfg(windows)]
    fn create(name: &str, first: bool, sa: Option<usize>) -> std::io::Result<NamedPipeServer> {
        let mut opts = ServerOptions::new();
        opts.first_pipe_instance(first).reject_remote_clients(true).max_instances(8);
        match sa {
            Some(addr) => unsafe { opts.create_with_security_attributes_raw(name, addr as *mut SECURITY_ATTRIBUTES as *mut _) },
            None => opts.create(name),
        }
    }

    #[cfg(windows)]
    pub async fn serve(app: AppHandle, inner: Arc<Mutex<Inner>>) {
        let name = pipe_name();
        let sa = security_attributes().map(|s| s as *mut SECURITY_ATTRIBUTES as usize);
        if sa.is_none() {
            log::warn!(target: "bridge", "descritor de segurança indisponível; usando o padrão do Windows");
        }
        loop {
            // `first_pipe_instance(true)` garante que nenhum outro processo já se apossou do nome.
            let mut server = match create(&name, true, sa) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!(target: "bridge", "pipe {name} indisponível: {e}");
                    if let Ok(mut g) = inner.lock() {
                        g.listening = false;
                        g.error = Some(e.to_string());
                    }
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    continue;
                }
            };
            if let Ok(mut g) = inner.lock() {
                g.listening = true;
                g.error = None;
            }
            log::info!(target: "bridge", "ouvindo em {name}");
            loop {
                if let Err(e) = server.connect().await {
                    log::warn!(target: "bridge", "falha ao aceitar conexão: {e}");
                    break;
                }
                let connected = server;
                // Já deixa a próxima instância pronta antes de atender esta.
                server = match create(&name, false, sa) {
                    Ok(s) => s,
                    Err(e) => {
                        log::warn!(target: "bridge", "falha ao criar instância: {e}");
                        tauri::async_runtime::spawn(handle(app.clone(), inner.clone(), connected));
                        break;
                    }
                };
                tauri::async_runtime::spawn(handle(app.clone(), inner.clone(), connected));
            }
        }
    }

    async fn handle<S: AsyncRead + AsyncWrite + Send + 'static>(app: AppHandle, inner: Arc<Mutex<Inner>>, pipe: S) {
        let (read_half, mut write_half) = tokio::io::split(pipe);
        let (tx, mut rx) = unbounded_channel::<String>();
        let id = {
            let Ok(mut g) = inner.lock() else { return };
            g.next_conn += 1;
            let id = g.next_conn;
            let now = now_ms();
            g.conns.insert(
                id,
                Conn {
                    family: "chromium".into(),
                    browser: "browser".into(),
                    version: String::new(),
                    connected_at_ms: now,
                    last_message_ms: now,
                    tx,
                },
            );
            id
        };
        let writer = tauri::async_runtime::spawn(async move {
            while let Some(line) = rx.recv().await {
                if write_half.write_all(line.as_bytes()).await.is_err() || write_half.write_all(b"\n").await.is_err() {
                    break;
                }
            }
        });

        let mut reader = BufReader::new(read_half);
        let mut window_start = std::time::Instant::now();
        let mut count = 0u32;
        loop {
            let mut buf = Vec::new();
            let n = match (&mut reader).take(proto::MAX_FRAME as u64 + 1).read_until(b'\n', &mut buf).await {
                Ok(n) => n,
                Err(_) => break,
            };
            if n == 0 || buf.len() > proto::MAX_FRAME {
                break;
            }
            // Limite simples: 60 mensagens por segundo por conexão.
            if window_start.elapsed() > Duration::from_secs(1) {
                window_start = std::time::Instant::now();
                count = 0;
            }
            count += 1;
            if count > 60 {
                continue;
            }
            while buf.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
                buf.pop();
            }
            if !buf.is_empty() {
                handle_line(&app, &inner, id, &buf);
            }
        }
        writer.abort();
        if let Ok(mut g) = inner.lock() {
            g.conns.remove(&id);
            let prefix = format!(":{id}:");
            g.tabs.retain(|k, _| !k.contains(&prefix));
            emit_tabs(&app, &g);
            let _ = app.emit("bridge://connections", conn_list(&g));
        }
        log::info!(target: "bridge", "extensão desconectada");
    }
}

// ------------------------------------------------------------ registro do host

const BROWSERS: &[(&str, &str, &str, &str)] = &[
    // id, nome, exe em App Paths, chave de NativeMessagingHosts
    ("chrome", "Google Chrome", "chrome.exe", r"Software\Google\Chrome\NativeMessagingHosts"),
    ("edge", "Microsoft Edge", "msedge.exe", r"Software\Microsoft\Edge\NativeMessagingHosts"),
    ("brave", "Brave", "brave.exe", r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"),
    ("firefox", "Firefox", "firefox.exe", r"Software\Mozilla\NativeMessagingHosts"),
];

/// Onde cada navegador procura manifestos de host nativo no Linux e no macOS: (pasta do
/// navegador que prova que ele está instalado, pasta dos manifestos).
#[cfg(not(windows))]
fn manifest_dirs(id: &str) -> Vec<(PathBuf, PathBuf)> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return Vec::new() };
    #[cfg(target_os = "macos")]
    let (base, hosts, firefox) = (home.join("Library/Application Support"), "NativeMessagingHosts", "Mozilla");
    #[cfg(not(target_os = "macos"))]
    let (base, hosts, firefox) = (home.join(".config"), "NativeMessagingHosts", "");
    let pair = |app: &str| (base.join(app), base.join(app).join(hosts));
    match id {
        #[cfg(target_os = "macos")]
        "chrome" => vec![pair("Google/Chrome"), pair("Chromium")],
        #[cfg(not(target_os = "macos"))]
        "chrome" => vec![pair("google-chrome"), pair("chromium")],
        #[cfg(target_os = "macos")]
        "edge" => vec![pair("Microsoft Edge")],
        #[cfg(not(target_os = "macos"))]
        "edge" => vec![pair("microsoft-edge")],
        "brave" => vec![pair("BraveSoftware/Brave-Browser")],
        "firefox" if firefox.is_empty() => vec![(home.join(".mozilla"), home.join(".mozilla/native-messaging-hosts"))],
        "firefox" => vec![(base.join("Firefox"), base.join(firefox).join(hosts))],
        _ => Vec::new(),
    }
}

/// O executável que o navegador abre. No AppImage o caminho real muda a cada execução (é
/// montado num diretório temporário), então vale o arquivo .AppImage.
fn host_exe() -> AppResult<PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(p) = std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|p| p.is_file()) {
        return Ok(p);
    }
    Ok(std::env::current_exe()?)
}

fn bridge_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::io(e.to_string()))?.join("bridge");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn extension_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("browser-extension");
        if p.join("chromium").join("manifest.json").exists() {
            return Some(p);
        }
    }
    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("browser-extension").join("dist");
        if p.exists() {
            return p.canonicalize().ok();
        }
    }
    None
}

fn write_manifests(app: &AppHandle) -> AppResult<(PathBuf, PathBuf)> {
    let dir = bridge_dir(app)?;
    let exe = host_exe()?.to_string_lossy().to_string();
    let chromium = serde_json::json!({
        "name": HOST_NAME,
        "description": "VANTA media bridge",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{}/", proto::CHROMIUM_EXTENSION_ID)]
    });
    let firefox = serde_json::json!({
        "name": HOST_NAME,
        "description": "VANTA media bridge",
        "path": exe,
        "type": "stdio",
        "allowed_extensions": [proto::FIREFOX_EXTENSION_ID]
    });
    let c = dir.join("chromium-host.json");
    let f = dir.join("firefox-host.json");
    std::fs::write(&c, serde_json::to_vec_pretty(&chromium)?)?;
    std::fs::write(&f, serde_json::to_vec_pretty(&firefox)?)?;
    Ok((c, f))
}

#[cfg(windows)]
mod reg {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::*;

    pub fn set_default(subkey: &str, value: &str) -> bool {
        unsafe {
            let mut key = HKEY::default();
            let sk = HSTRING::from(subkey);
            if RegCreateKeyExW(HKEY_CURRENT_USER, &sk, None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None)
                != ERROR_SUCCESS
            {
                return false;
            }
            let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
            let ok = RegSetValueExW(key, PCWSTR::null(), None, REG_SZ, Some(bytes)) == ERROR_SUCCESS;
            let _ = RegCloseKey(key);
            ok
        }
    }

    pub fn get_default(root: HKEY, subkey: &str) -> Option<String> {
        unsafe {
            let sk = HSTRING::from(subkey);
            let mut size = 0u32;
            if RegGetValueW(root, &sk, PCWSTR::null(), RRF_RT_REG_SZ, None, None, Some(&mut size)) != ERROR_SUCCESS || size == 0 {
                return None;
            }
            let mut buf = vec![0u16; (size as usize).div_ceil(2)];
            if RegGetValueW(root, &sk, PCWSTR::null(), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut size))
                != ERROR_SUCCESS
            {
                return None;
            }
            let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..end]))
        }
    }

    pub fn delete_tree(subkey: &str) {
        unsafe {
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(subkey));
            let _ = RegDeleteKeyW(HKEY_CURRENT_USER, &HSTRING::from(subkey));
        }
    }

    pub fn installed(exe: &str) -> bool {
        let sub = format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
        get_default(HKEY_LOCAL_MACHINE, &sub).is_some() || get_default(HKEY_CURRENT_USER, &sub).is_some()
    }

    pub fn hkcu() -> HKEY {
        HKEY_CURRENT_USER
    }
}

fn browsers(app: &AppHandle) -> Vec<BrowserInfo> {
    let expected = bridge_dir(app).ok();
    BROWSERS
        .iter()
        .map(|(id, name, exe, key)| {
            #[cfg(windows)]
            let (installed, registered) = {
                let manifest = if *id == "firefox" { "firefox-host.json" } else { "chromium-host.json" };
                let want = expected.as_ref().map(|d| d.join(manifest).to_string_lossy().to_lowercase());
                let current = reg::get_default(reg::hkcu(), &format!(r"{key}\{HOST_NAME}")).map(|s| s.to_lowercase());
                (reg::installed(exe), current.is_some() && current == want)
            };
            #[cfg(not(windows))]
            let (installed, registered) = {
                let _ = (exe, key, &expected);
                let dirs = manifest_dirs(id);
                let exe = host_exe().ok().map(|p| p.to_string_lossy().to_string());
                let installed = dirs.iter().any(|(app, _)| app.is_dir());
                let registered = dirs.iter().any(|(_, hosts)| {
                    std::fs::read_to_string(hosts.join(format!("{HOST_NAME}.json")))
                        .ok()
                        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                        .is_some_and(|v| v["path"].as_str().map(str::to_string) == exe)
                });
                (installed, registered)
            };
            BrowserInfo { id: (*id).into(), name: (*name).into(), installed, registered }
        })
        .collect()
}

#[tauri::command]
pub fn bridge_status(app: AppHandle, bridge: State<'_, Bridge>) -> BridgeStatus {
    let (listening, error, connections) = bridge
        .inner
        .lock()
        .map(|g| (g.listening, g.error.clone(), conn_list(&g)))
        .unwrap_or((false, None, vec![]));
    BridgeStatus {
        listening,
        error,
        connections,
        browsers: browsers(&app),
        extension_id: proto::CHROMIUM_EXTENSION_ID.into(),
        extension_dir: extension_dir(&app).map(|p| p.to_string_lossy().to_string()),
        host_name: HOST_NAME.into(),
    }
}

#[tauri::command]
pub fn bridge_tabs(bridge: State<'_, Bridge>) -> Vec<BrowserTab> {
    bridge.inner.lock().map(|g| tabs_list(&g)).unwrap_or_default()
}

/// Registra o host nativo para os navegadores. Só escreve em HKCU e na pasta de dados do VANTA.
#[tauri::command]
pub fn bridge_register(app: AppHandle) -> AppResult<Vec<BrowserInfo>> {
    let (chromium, firefox) = write_manifests(&app)?;
    #[cfg(windows)]
    for (id, _, _, key) in BROWSERS {
        let manifest = if *id == "firefox" { &firefox } else { &chromium };
        if !reg::set_default(&format!(r"{key}\{HOST_NAME}"), &manifest.to_string_lossy()) {
            return Err(AppError::io(format!("não foi possível registrar o host para {id}")));
        }
    }
    // Linux e macOS: uma cópia do manifesto na pasta de cada navegador instalado.
    #[cfg(not(windows))]
    for (id, _, _, _) in BROWSERS {
        let manifest = if *id == "firefox" { &firefox } else { &chromium };
        for (app_dir, hosts) in manifest_dirs(id) {
            if !app_dir.is_dir() {
                continue;
            }
            std::fs::create_dir_all(&hosts)?;
            std::fs::copy(manifest, hosts.join(format!("{HOST_NAME}.json")))?;
        }
    }
    log::info!(target: "bridge", "host nativo registrado");
    Ok(browsers(&app))
}

#[tauri::command]
pub fn bridge_unregister(app: AppHandle) -> AppResult<Vec<BrowserInfo>> {
    #[cfg(windows)]
    for (_, _, _, key) in BROWSERS {
        reg::delete_tree(&format!(r"{key}\{HOST_NAME}"));
    }
    #[cfg(not(windows))]
    for (id, _, _, _) in BROWSERS {
        for (_, hosts) in manifest_dirs(id) {
            let _ = std::fs::remove_file(hosts.join(format!("{HOST_NAME}.json")));
        }
    }
    if let Ok(dir) = bridge_dir(&app) {
        let _ = std::fs::remove_file(dir.join("chromium-host.json"));
        let _ = std::fs::remove_file(dir.join("firefox-host.json"));
    }
    Ok(browsers(&app))
}

const ALLOWED_ACTIONS: &[&str] = &["play", "pause", "toggle", "next", "previous", "seek"];

#[tauri::command]
pub fn bridge_command(bridge: State<'_, Bridge>, key: String, action: String, position_ms: Option<i64>) -> AppResult<()> {
    if !ALLOWED_ACTIONS.contains(&action.as_str()) {
        return Err(AppError::invalid("ação desconhecida"));
    }
    let g = bridge.inner.lock().map_err(|_| AppError::io("lock"))?;
    let tab = g.tabs.get(&key).ok_or_else(|| AppError::new("session_gone", "a aba não está mais tocando"))?;
    let conn: u64 = key.split(':').nth(1).and_then(|c| c.parse().ok()).ok_or_else(|| AppError::invalid("chave inválida"))?;
    let c = g.conns.get(&conn).ok_or_else(|| AppError::unavailable("extensão desconectada"))?;
    let msg = AppMessage::Command { tab_id: tab.tab_id, action, position_ms: position_ms.map(|p| p.max(0)) };
    c.tx.send(serde_json::to_string(&msg)?).map_err(|_| AppError::unavailable("extensão desconectada"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub browser: String,
    pub ok: bool,
    pub rtt_ms: Option<i64>,
}

/// Teste de comunicação ponta a ponta: VANTA → host → extensão → host → VANTA.
#[tauri::command]
pub async fn bridge_ping(bridge: State<'_, Bridge>) -> AppResult<Vec<PingResult>> {
    let started = now_ms();
    let mut sent: Vec<(String, u64)> = Vec::new();
    {
        let g = bridge.inner.lock().map_err(|_| AppError::io("lock"))?;
        for (i, c) in g.conns.values().enumerate() {
            let nonce = (started as u64).wrapping_mul(31).wrapping_add(i as u64 + 1);
            if c.tx.send(serde_json::to_string(&AppMessage::Ping { nonce })?).is_ok() {
                sent.push((c.browser.clone(), nonce));
            }
        }
    }
    let inner = bridge.inner.clone();
    for _ in 0..25 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let done = inner.lock().map(|g| sent.iter().all(|(_, n)| g.pongs.contains_key(n))).unwrap_or(true);
        if done {
            break;
        }
    }
    let mut g = inner.lock().map_err(|_| AppError::io("lock"))?;
    let out = sent
        .iter()
        .map(|(browser, n)| {
            let at = g.pongs.remove(n);
            PingResult { browser: browser.clone(), ok: at.is_some(), rtt_ms: at.map(|t| t - started) }
        })
        .collect();
    g.pongs.clear();
    Ok(out)
}
