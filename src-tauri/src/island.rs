//! A janela da cápsula: posicionamento por monitor/DPI, regiões de interação,
//! foco sob demanda e ocultação em tela cheia.
//!
//! A janela tem tamanho fixo e fundo transparente; o que o usuário vê é só a cápsula
//! desenhada pelo WebView. Fora do retângulo da cápsula a janela ignora o cursor
//! (`WS_EX_TRANSPARENT` via `set_ignore_cursor_events`), então os cliques chegam ao app
//! que está por baixo. Quem decide é uma thread leve que lê `GetCursorPos` — enquanto a
//! janela ignora o cursor ela não recebe eventos de mouse, então não há outra forma de
//! saber que o ponteiro voltou para cima da cápsula.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::error::{AppError, AppResult};

pub const ISLAND_LABEL: &str = "island";
/// Tamanho lógico máximo (CSS px) da janela: cabe a cápsula redimensionada e as
/// configurações ampliadas. O que não é cápsula é transparente e deixa o clique passar.
/// Em telas menores a janela é limitada à área de trabalho.
pub const WINDOW_W: f64 = 1200.0;
pub const WINDOW_H: f64 = 780.0;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn contains(&self, px: f64, py: f64) -> bool {
        self.w > 0.0 && px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IslandPrefs {
    /// "always" | "hideFullscreen"
    pub visibility: String,
    /// `None` = monitor principal; caso contrário o nome reportado pelo Windows.
    pub monitor: Option<String>,
    pub show: bool,
    /// Deslocamento vertical extra em px lógicos (0..=24).
    pub offset_y: f64,
    /// Só na área de trabalho: a ilha fica ATRÁS das janelas abertas (no nível do papel de
    /// parede), em vez de sempre por cima. Padrão: ligado.
    #[serde(default = "default_true")]
    pub desktop_only: bool,
}

fn default_true() -> bool {
    true
}

impl Default for IslandPrefs {
    fn default() -> Self {
        Self { visibility: "hideFullscreen".into(), monitor: None, show: true, offset_y: 0.0, desktop_only: true }
    }
}

/// Camada da janela: por baixo de todas as outras (área de trabalho) ou sempre por cima.
fn apply_layer(win: &tauri::WebviewWindow, desktop_only: bool) {
    if desktop_only {
        let _ = win.set_always_on_top(false);
        let _ = win.set_always_on_bottom(true);
    } else {
        let _ = win.set_always_on_bottom(false);
        let _ = win.set_always_on_top(true);
    }
}

#[derive(Default)]
struct Shared {
    /// Região interativa em px lógicos relativos à janela (definida pelo frontend após o layout).
    hit: Rect,
    expanded: bool,
    prefs: IslandPrefs,
    hidden_by_fullscreen: bool,
    monitor_signature: String,
    /// Posição de repouso (física) calculada por `place`.
    home: Option<(i32, i32)>,
    /// O usuário arrastou a cápsula para longe da posição de repouso.
    away: bool,
    /// Tamanho lógico atual da janela (depois do limite pela área de trabalho).
    logical: (f64, f64),
}

pub struct Island {
    shared: Arc<Mutex<Shared>>,
    focus_requested: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PointerPayload {
    inside: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
}

fn island_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(ISLAND_LABEL)
}

fn pick_monitor(win: &WebviewWindow, prefs: &IslandPrefs) -> Option<tauri::Monitor> {
    let primary = win.primary_monitor().ok().flatten();
    if let Some(name) = &prefs.monitor {
        if let Ok(list) = win.available_monitors() {
            if let Some(m) = list.into_iter().find(|m| m.name().map(|n| n == name).unwrap_or(false)) {
                return Some(m);
            }
        }
    }
    primary.or_else(|| win.available_monitors().ok().and_then(|l| l.into_iter().next()))
}

fn monitors_signature(win: &WebviewWindow) -> String {
    win.available_monitors()
        .map(|list| {
            list.iter()
                .map(|m| {
                    let wa = m.work_area();
                    format!(
                        "{}:{}x{}@{},{}:{}:{}:{}",
                        m.name().cloned().unwrap_or_default(),
                        m.size().width,
                        m.size().height,
                        m.position().x,
                        m.position().y,
                        m.scale_factor(),
                        wa.position.y,
                        wa.size.height
                    )
                })
                .collect::<Vec<_>>()
                .join("|")
        })
        .unwrap_or_default()
}

/// Centraliza a janela no topo da área de trabalho do monitor escolhido,
/// respeitando a escala (DPI) daquele monitor e uma barra de tarefas no topo.
pub fn place(app: &AppHandle) -> AppResult<()> {
    let Some(win) = island_window(app) else { return Ok(()) };
    let prefs = app.state::<Island>().shared.lock().map(|s| s.prefs.clone()).unwrap_or_default();
    let Some(mon) = pick_monitor(&win, &prefs) else {
        return Err(AppError::unavailable("nenhum monitor encontrado"));
    };
    let scale = mon.scale_factor();
    let wa = mon.work_area();
    let lw = WINDOW_W.min(wa.size.width as f64 / scale).floor();
    let lh = WINDOW_H.min(wa.size.height as f64 / scale).floor();
    let w = (lw * scale).round() as u32;
    let h = (lh * scale).round() as u32;
    let x = wa.position.x + (wa.size.width as i32 - w as i32) / 2;
    let y = wa.position.y + (prefs.offset_y.clamp(0.0, 24.0) * scale).round() as i32;
    win.set_size(PhysicalSize::new(w, h))?;
    win.set_position(PhysicalPosition::new(x, y))?;
    if let Ok(mut s) = app.state::<Island>().shared.lock() {
        s.home = Some((x, y));
        s.away = false;
        s.logical = (lw, lh);
    }
    let _ = app.emit_to(ISLAND_LABEL, "island://geometry", (lw, lh));
    log::info!(target: "island", "posicionada em {x},{y} {w}x{h} escala {scale} monitor {:?}", mon.name());
    Ok(())
}

pub fn init(app: &AppHandle) -> Island {
    let island = Island {
        shared: Arc::new(Mutex::new(Shared::default())),
        focus_requested: Arc::new(AtomicBool::new(false)),
    };
    spawn_pointer_thread(app.clone(), island.shared.clone());
    spawn_watch_thread(app.clone(), island.shared.clone());
    island
}

pub fn show_after_setup(app: &AppHandle) {
    if let Some(win) = island_window(app) {
        let _ = place(app);
        // Começa ignorando o cursor; a thread de ponteiro liga a interação sobre a cápsula.
        let _ = win.set_ignore_cursor_events(true);
        let (show, desktop_only) = app.state::<Island>().shared.lock().map(|s| (s.prefs.show, s.prefs.desktop_only)).unwrap_or((true, true));
        apply_layer(&win, desktop_only);
        if show {
            let _ = win.show();
        }
        #[cfg(windows)]
        win32::apply_tool_window_style(&win);
    }
}

fn spawn_pointer_thread(app: AppHandle, shared: Arc<Mutex<Shared>>) {
    std::thread::Builder::new()
        .name("vanta-pointer".into())
        .spawn(move || {
            let mut inside = false;
            let mut ignoring = true;
            let mut was_down = false;
            loop {
                let Some(win) = island_window(&app) else {
                    std::thread::sleep(Duration::from_millis(500));
                    continue;
                };
                let (hit, expanded, (lw, lh)) = match shared.lock() {
                    Ok(s) => (s.hit, s.expanded, s.logical),
                    Err(_) => return,
                };
                let visible = win.is_visible().unwrap_or(false);
                let mut sleep_ms = 120;
                if let (true, Some((cx, cy)), Ok(pos), Ok(scale)) =
                    (visible, cursor_pos(), win.outer_position(), win.scale_factor())
                {
                    let lx = (cx - pos.x) as f64 / scale;
                    let ly = (cy - pos.y) as f64 / scale;
                    let now_inside = hit.contains(lx, ly);
                    // Perto da janela, amostra mais rápido para o hover parecer imediato.
                    let near = lx > -80.0 && lx < lw + 80.0 && ly > -40.0 && ly < lh + 60.0;
                    sleep_ms = if near { 33 } else { 140 };
                    if now_inside != inside {
                        inside = now_inside;
                        let _ = app.emit_to(ISLAND_LABEL, "island://pointer", PointerPayload { inside });
                    }
                    let want_ignore = !now_inside;
                    if want_ignore != ignoring {
                        ignoring = want_ignore;
                        let _ = win.set_ignore_cursor_events(ignoring);
                    }
                    // Clique fora com a cápsula expandida: o clique foi para outro app
                    // (passou através da janela), então a cápsula só fica sabendo por aqui.
                    let down = mouse_down();
                    if expanded && down && !was_down && !now_inside {
                        let _ = app.emit_to(ISLAND_LABEL, "island://outside-click", ());
                    }
                    was_down = down;
                }
                std::thread::sleep(Duration::from_millis(sleep_ms));
            }
        })
        .expect("thread de ponteiro");
}

fn spawn_watch_thread(app: AppHandle, shared: Arc<Mutex<Shared>>) {
    std::thread::Builder::new()
        .name("vanta-island-watch".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(1500));
            let Some(win) = island_window(&app) else { continue };
            // 1) Mudança de monitores (conectar/desconectar, troca de escala, barra de tarefas).
            let sig = monitors_signature(&win);
            let changed = match shared.lock() {
                Ok(mut s) => {
                    let c = !s.monitor_signature.is_empty() && s.monitor_signature != sig;
                    s.monitor_signature = sig;
                    // Monitores mudaram: a posição de repouso vale mais que um arrasto antigo.
                    c
                }
                Err(_) => return,
            };
            if changed {
                log::info!(target: "island", "geometria de monitores mudou; reposicionando");
                let _ = place(&app);
            }
            // 2) Aplicativo em tela cheia (jogo, apresentação, vídeo).
            let (mode, show, was_hidden) = match shared.lock() {
                Ok(s) => (s.prefs.visibility.clone(), s.prefs.show, s.hidden_by_fullscreen),
                Err(_) => return,
            };
            if !show {
                continue;
            }
            let fullscreen = mode == "hideFullscreen" && is_fullscreen_busy();
            if fullscreen && !was_hidden {
                let _ = win.hide();
                if let Ok(mut s) = shared.lock() {
                    s.hidden_by_fullscreen = true;
                }
            } else if !fullscreen && was_hidden {
                let _ = win.show();
                if let Ok(mut s) = shared.lock() {
                    s.hidden_by_fullscreen = false;
                }
            }
        })
        .expect("thread de observação");
}

#[cfg(windows)]
fn cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok().map(|_| (p.x, p.y)) }
}

#[cfg(windows)]
fn mouse_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 || (GetAsyncKeyState(VK_RBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

#[cfg(windows)]
fn is_fullscreen_busy() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn cursor_pos() -> Option<(i32, i32)> {
    None
}
#[cfg(not(windows))]
fn mouse_down() -> bool {
    false
}
#[cfg(not(windows))]
fn is_fullscreen_busy() -> bool {
    false
}

#[cfg(windows)]
mod win32 {
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW};

    /// Tira a cápsula do Alt+Tab: ela não é uma "janela" para o usuário alternar.
    pub fn apply_tool_window_style(win: &WebviewWindow) {
        if let Ok(h) = win.hwnd() {
            let hwnd = HWND(h.0 as _);
            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let ex = (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
            }
        }
    }
}

// ---------------------------------------------------------------- comandos

fn sane(v: f64) -> bool {
    v.is_finite() && (-10.0..=4000.0).contains(&v)
}

#[tauri::command]
pub fn island_set_hit_rect(island: State<'_, Island>, rect: Rect) -> AppResult<()> {
    if !(sane(rect.x) && sane(rect.y) && sane(rect.w) && sane(rect.h)) {
        return Err(AppError::invalid("retângulo inválido"));
    }
    if let Ok(mut s) = island.shared.lock() {
        s.hit = rect;
    }
    Ok(())
}

#[tauri::command]
pub fn island_set_expanded(island: State<'_, Island>, expanded: bool) {
    if let Ok(mut s) = island.shared.lock() {
        s.expanded = expanded;
    }
}

/// Torna a cápsula focável e a ativa. Só é chamado por intenção explícita do usuário
/// (clique num campo de texto, atalho global); atualizações de mídia nunca chamam isto.
#[tauri::command]
pub fn island_request_focus(app: AppHandle, island: State<'_, Island>) -> AppResult<()> {
    let win = island_window(&app).ok_or_else(|| AppError::unavailable("janela ausente"))?;
    island.focus_requested.store(true, Ordering::SeqCst);
    win.set_focusable(true)?;
    win.set_ignore_cursor_events(false)?;
    win.set_focus()?;
    Ok(())
}

#[tauri::command]
pub fn island_release_focus(app: AppHandle, island: State<'_, Island>) -> AppResult<()> {
    let win = island_window(&app).ok_or_else(|| AppError::unavailable("janela ausente"))?;
    if island.focus_requested.swap(false, Ordering::SeqCst) {
        win.set_focusable(false)?;
    }
    Ok(())
}

#[tauri::command]
pub fn island_apply_prefs(app: AppHandle, island: State<'_, Island>, prefs: IslandPrefs) -> AppResult<()> {
    if !matches!(prefs.visibility.as_str(), "always" | "hideFullscreen") {
        return Err(AppError::invalid("modo de visibilidade inválido"));
    }
    let changed_geometry;
    {
        let mut s = island.shared.lock().map_err(|_| AppError::io("lock"))?;
        changed_geometry = s.prefs.monitor != prefs.monitor || s.prefs.offset_y != prefs.offset_y;
        s.prefs = prefs.clone();
        if !prefs.show {
            s.hidden_by_fullscreen = false;
        }
    }
    if changed_geometry {
        place(&app)?;
    }
    if let Some(win) = island_window(&app) {
        apply_layer(&win, prefs.desktop_only);
        if prefs.show && !win.is_visible().unwrap_or(false) {
            win.show()?;
        } else if !prefs.show && win.is_visible().unwrap_or(false) {
            win.hide()?;
        }
    }
    Ok(())
}

pub fn toggle_visible(app: &AppHandle) {
    let island = app.state::<Island>();
    let show = {
        let Ok(mut s) = island.shared.lock() else { return };
        s.prefs.show = !s.prefs.show;
        s.prefs.show
    };
    if let Some(win) = island_window(app) {
        let _ = if show { win.show() } else { win.hide() };
    }
    let _ = app.emit("island://visibility", show);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragOrigin {
    pub x: i32,
    pub y: i32,
    pub scale: f64,
}

/// Início de um arrasto: devolve a posição física atual da janela e a escala do monitor.
#[tauri::command]
pub fn island_drag_start(app: AppHandle) -> AppResult<DragOrigin> {
    let win = island_window(&app).ok_or_else(|| AppError::unavailable("janela ausente"))?;
    let p = win.outer_position()?;
    Ok(DragOrigin { x: p.x, y: p.y, scale: win.scale_factor()? })
}

/// Move a janela durante o arrasto (coordenadas físicas, limitadas à área virtual de telas).
#[tauri::command]
pub fn island_set_position(app: AppHandle, island: State<'_, Island>, x: i32, y: i32) -> AppResult<()> {
    if !(-20_000..=40_000).contains(&x) || !(-20_000..=40_000).contains(&y) {
        return Err(AppError::invalid("posição fora da área de trabalho"));
    }
    let win = island_window(&app).ok_or_else(|| AppError::unavailable("janela ausente"))?;
    win.set_position(PhysicalPosition::new(x, y))?;
    if let Ok(mut s) = island.shared.lock() {
        s.away = s.home != Some((x, y));
    }
    Ok(())
}

/// Volta à posição de repouso com uma curva suave (thread própria, ~60 quadros/s).
#[tauri::command]
pub fn island_return_home(app: AppHandle, island: State<'_, Island>, duration_ms: Option<u64>) -> AppResult<()> {
    let win = island_window(&app).ok_or_else(|| AppError::unavailable("janela ausente"))?;
    let Some((hx, hy)) = island.shared.lock().ok().and_then(|s| s.home) else { return Ok(()) };
    let from = win.outer_position()?;
    let total = duration_ms.unwrap_or(620).clamp(0, 2000);
    let shared = island.shared.clone();
    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        loop {
            let t = (start.elapsed().as_millis() as f64 / total.max(1) as f64).min(1.0);
            // easeOutBack suave: chega com um leve assentamento, sem quicar.
            let c1 = 1.10158;
            let c3 = c1 + 1.0;
            let e = if total == 0 { 1.0 } else { 1.0 + c3 * (t - 1.0).powi(3) + c1 * (t - 1.0).powi(2) };
            let x = from.x as f64 + (hx - from.x) as f64 * e;
            let y = from.y as f64 + (hy - from.y) as f64 * e;
            let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
            if t >= 1.0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(14));
        }
        if let Ok(mut s) = shared.lock() {
            s.away = false;
        }
    });
    Ok(())
}

/// Tamanho lógico atual da janela. A página pode carregar antes de `place` redimensioná-la,
/// então a interface pergunta em vez de confiar no primeiro `innerWidth`.
#[tauri::command]
pub fn island_geometry(app: AppHandle, island: State<'_, Island>) -> (f64, f64) {
    if let Some(win) = island_window(&app) {
        if let (Ok(size), Ok(scale)) = (win.inner_size(), win.scale_factor()) {
            return ((size.width as f64 / scale).round(), (size.height as f64 / scale).round());
        }
    }
    island.shared.lock().map(|s| s.logical).unwrap_or((WINDOW_W, WINDOW_H))
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> AppResult<Vec<MonitorInfo>> {
    let win = island_window(&app).ok_or_else(|| AppError::unavailable("janela ausente"))?;
    let primary = win.primary_monitor()?.and_then(|m| m.name().cloned());
    Ok(win
        .available_monitors()?
        .into_iter()
        .map(|m| {
            let name = m.name().cloned().unwrap_or_default();
            MonitorInfo {
                primary: Some(&name) == primary.as_ref(),
                width: m.size().width,
                height: m.size().height,
                scale: m.scale_factor(),
                name,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::Rect;

    #[test]
    fn rect_contains_is_inclusive_and_empty_rect_never_hits() {
        let r = Rect { x: 10.0, y: 0.0, w: 100.0, h: 40.0 };
        assert!(r.contains(10.0, 0.0));
        assert!(r.contains(110.0, 40.0));
        assert!(!r.contains(111.0, 20.0));
        assert!(!Rect::default().contains(0.0, 0.0));
    }
}
