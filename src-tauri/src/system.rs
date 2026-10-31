//! Informações do sistema, abertura de URIs permitidas, janela de configurações e atalho global.

use std::str::FromStr;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub log_dir: String,
    pub reduced_motion: bool,
    pub debug: bool,
}

#[cfg(windows)]
pub fn system_reduced_motion() -> bool {
    use windows::core::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS};
    let mut enabled = BOOL(1);
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some(&mut enabled as *mut _ as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    ok.is_ok() && !enabled.as_bool()
}

#[cfg(not(windows))]
pub fn system_reduced_motion() -> bool {
    false
}

#[tauri::command]
pub fn system_info(app: AppHandle) -> SystemInfo {
    let p = app.path();
    SystemInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: p.app_data_dir().map(|d| d.to_string_lossy().to_string()).unwrap_or_default(),
        log_dir: p.app_log_dir().map(|d| d.to_string_lossy().to_string()).unwrap_or_default(),
        reduced_motion: system_reduced_motion(),
        debug: cfg!(debug_assertions),
    }
}

/// Lista fechada de destinos. URLs de mídia só passam se forem https.
pub fn uri_allowed(uri: &str) -> bool {
    const SETTINGS: &[&str] = &[
        "ms-settings:sound",
        "ms-settings:bluetooth",
        "ms-settings:batterysaver",
        "ms-settings:powersleep",
        "ms-settings:notifications",
        "ms-settings:easeofaccess-display",
        "ms-settings:startupapps",
    ];
    if SETTINGS.contains(&uri) {
        return true;
    }
    uri.len() <= 2048 && uri.starts_with("https://") && !uri.contains(char::is_whitespace)
}

#[tauri::command]
pub fn open_uri(app: AppHandle, uri: String) -> AppResult<()> {
    if !uri_allowed(&uri) {
        return Err(AppError::invalid("destino não permitido"));
    }
    app.opener().open_url(uri, None::<&str>).map_err(|e| AppError::io(e.to_string()))
}

#[tauri::command]
pub fn open_app_folder(app: AppHandle, which: String) -> AppResult<()> {
    let p = app.path();
    let dir = match which.as_str() {
        "data" => p.app_data_dir(),
        "logs" => p.app_log_dir(),
        _ => return Err(AppError::invalid("pasta desconhecida")),
    }
    .map_err(|e| AppError::io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    app.opener().open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(|e| AppError::io(e.to_string()))
}

#[tauri::command]
pub fn open_extension_folder(app: AppHandle, bridge: State<'_, crate::bridge::Bridge>) -> AppResult<()> {
    let status = crate::bridge::bridge_status(app.clone(), bridge);
    let dir = status.extension_dir.ok_or_else(|| AppError::unavailable("pasta da extensão não encontrada"))?;
    app.opener().open_path(dir, None::<&str>).map_err(|e| AppError::io(e.to_string()))
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> AppResult<u32> {
    let dir = app.path().app_log_dir().map_err(|e| AppError::io(e.to_string()))?;
    let mut n = 0;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let path = e.path();
            // O arquivo em uso é truncado, os rotacionados são apagados.
            let is_log = path.extension().and_then(|x| x.to_str()) == Some("log");
            if is_log && (std::fs::write(&path, b"").is_ok() || std::fs::remove_file(&path).is_ok()) {
                n += 1;
            }
        }
    }
    Ok(n)
}

/// As configurações abrem DENTRO da cápsula: ela se amplia e pega o teclado.
pub fn open_settings_window(app: &AppHandle, section: Option<String>) -> AppResult<()> {
    let section = section.filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && s.len() < 32);
    let win = app
        .get_webview_window(crate::island::ISLAND_LABEL)
        .ok_or_else(|| AppError::unavailable("janela ausente"))?;
    if !win.is_visible().unwrap_or(false) {
        win.show()?;
    }
    win.set_focusable(true)?;
    win.set_ignore_cursor_events(false)?;
    let _ = win.set_focus();
    app.emit_to(crate::island::ISLAND_LABEL, "island://open-settings", section.unwrap_or_default())?;
    Ok(())
}

#[tauri::command]
pub fn open_settings(app: AppHandle, section: Option<String>) -> AppResult<()> {
    open_settings_window(&app, section)
}

#[derive(Default)]
pub struct ShortcutHolder {
    current: Mutex<Option<Shortcut>>,
}

/// Atalho global configurável para abrir/fechar a cápsula com o teclado.
#[tauri::command]
pub fn set_global_shortcut(app: AppHandle, holder: State<'_, ShortcutHolder>, accelerator: Option<String>) -> AppResult<()> {
    let gs = app.global_shortcut();
    let mut cur = holder.current.lock().map_err(|_| AppError::io("lock"))?;
    if let Some(old) = cur.take() {
        let _ = gs.unregister(old);
    }
    let Some(acc) = accelerator.filter(|a| !a.trim().is_empty()) else { return Ok(()) };
    if acc.len() > 64 {
        return Err(AppError::invalid("atalho inválido"));
    }
    let sc = Shortcut::from_str(&acc).map_err(|e| AppError::invalid(format!("atalho inválido: {e}")))?;
    if sc.mods.is_empty() {
        return Err(AppError::invalid("o atalho precisa de Ctrl, Alt, Shift ou Win"));
    }
    gs.on_shortcut(sc, |app, _sc, ev| {
        if ev.state == ShortcutState::Pressed {
            let _ = app.emit_to(crate::island::ISLAND_LABEL, "island://shortcut", ());
        }
    })
    .map_err(|e| AppError::new("shortcut_taken", format!("não foi possível registrar: {e}")))?;
    *cur = Some(sc);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::uri_allowed;

    #[test]
    fn only_allowlisted_uris_open() {
        assert!(uri_allowed("ms-settings:sound"));
        assert!(uri_allowed("https://www.youtube.com/watch?v=x"));
        assert!(!uri_allowed("ms-settings:windowsupdate-action"));
        assert!(!uri_allowed("file:///C:/Windows/System32/calc.exe"));
        assert!(!uri_allowed("javascript:alert(1)"));
        assert!(!uri_allowed("http://example.com"));
    }
}
