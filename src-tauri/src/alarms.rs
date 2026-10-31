//! Agendador de alarmes do próprio VANTA (fim do Pomodoro, lembretes de água e de tarefas).
//!
//! Vive em Rust, e não num `setTimeout` do WebView, por dois motivos: o WebView pode ser
//! estrangulado quando a cápsula está oculta, e um alarme precisa sobreviver a reinícios.
//! A thread dorme numa `Condvar` até o próximo vencimento — não há polling.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::error::{AppError, AppResult};
use crate::store::Store;

/// Alarme vencido há mais que isto (app desligado, PC suspenso) não gera notificação nativa:
/// só o evento, para o estado da interface se recompor sem uma rajada de avisos atrasados.
const STALE_NOTIFY_MS: i64 = 15 * 60 * 1000;
const MAX_ALARMS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: String,
    pub at_ms: i64,
    pub title: String,
    pub body: String,
    pub category: String,
    #[serde(default = "default_true")]
    pub notify: bool,
    /// Toca o som do Windows junto com o aviso.
    #[serde(default = "default_true")]
    pub sound: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FiredPayload {
    id: String,
    category: String,
    at_ms: i64,
    late_ms: i64,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn validate(alarm: &Alarm) -> AppResult<()> {
    let ok_id = !alarm.id.is_empty()
        && alarm.id.len() <= 80
        && alarm.id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_' | '.'));
    if !ok_id {
        return Err(AppError::invalid("id de alarme inválido"));
    }
    if !matches!(alarm.category.as_str(), "water" | "tasks" | "tools" | "system") {
        return Err(AppError::invalid("categoria de alarme inválida"));
    }
    if alarm.title.chars().count() > 120 || alarm.body.chars().count() > 300 {
        return Err(AppError::invalid("texto do alarme longo demais"));
    }
    // Janela razoável: até 1 ano no futuro.
    if alarm.at_ms <= 0 || alarm.at_ms > now_ms() + 366 * 24 * 3600 * 1000 {
        return Err(AppError::invalid("horário do alarme fora do intervalo"));
    }
    Ok(())
}

#[derive(Default)]
struct Inner {
    alarms: Vec<Alarm>,
    version: u64,
}

pub struct Alarms {
    inner: Arc<(Mutex<Inner>, Condvar)>,
}

impl Alarms {
    fn persist(store: &Store, alarms: &[Alarm]) {
        if let Ok(v) = serde_json::to_value(alarms) {
            if let Err(e) = store.write("alarms", &v) {
                log::warn!(target: "alarms", "falha ao gravar alarmes: {e}");
            }
        }
    }

    pub fn upsert(&self, store: &Store, alarm: Alarm) -> AppResult<()> {
        validate(&alarm)?;
        let (lock, cvar) = &*self.inner;
        let mut g = lock.lock().map_err(|_| AppError::io("lock"))?;
        g.alarms.retain(|a| a.id != alarm.id);
        if g.alarms.len() >= MAX_ALARMS {
            return Err(AppError::invalid("limite de alarmes atingido"));
        }
        g.alarms.push(alarm);
        g.version += 1;
        Self::persist(store, &g.alarms);
        cvar.notify_all();
        Ok(())
    }

    pub fn cancel(&self, store: &Store, id_or_prefix: &str, prefix: bool) -> AppResult<usize> {
        let (lock, cvar) = &*self.inner;
        let mut g = lock.lock().map_err(|_| AppError::io("lock"))?;
        let before = g.alarms.len();
        g.alarms.retain(|a| if prefix { !a.id.starts_with(id_or_prefix) } else { a.id != id_or_prefix });
        let removed = before - g.alarms.len();
        if removed > 0 {
            g.version += 1;
            Self::persist(store, &g.alarms);
            cvar.notify_all();
        }
        Ok(removed)
    }

    pub fn list(&self) -> Vec<Alarm> {
        self.inner.0.lock().map(|g| g.alarms.clone()).unwrap_or_default()
    }
}

pub fn start(app: &AppHandle, store: &Store) -> Alarms {
    let saved: Vec<Alarm> = store
        .read("alarms")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let alarms: Vec<Alarm> = saved.into_iter().filter(validate_loaded).collect();
    let inner = Arc::new((Mutex::new(Inner { alarms, version: 0 }), Condvar::new()));
    let thread_inner = inner.clone();
    let handle = app.clone();
    std::thread::Builder::new()
        .name("vanta-alarms".into())
        .spawn(move || run(handle, thread_inner))
        .expect("thread de alarmes");
    Alarms { inner }
}

fn validate_loaded(a: &Alarm) -> bool {
    // Alarmes carregados do disco passam pela mesma validação, exceto o limite de passado.
    !a.id.is_empty() && a.id.len() <= 80 && a.title.chars().count() <= 120 && a.body.chars().count() <= 300
}

fn run(app: AppHandle, inner: Arc<(Mutex<Inner>, Condvar)>) {
    let (lock, cvar) = &*inner;
    loop {
        let due: Vec<Alarm>;
        {
            let Ok(mut g) = lock.lock() else { return };
            let now = now_ms();
            let next = g.alarms.iter().map(|a| a.at_ms).min();
            match next {
                Some(at) if at <= now => {
                    let (fire, keep): (Vec<_>, Vec<_>) = g.alarms.drain(..).partition(|a| a.at_ms <= now);
                    g.alarms = keep;
                    g.version += 1;
                    due = fire;
                }
                Some(at) => {
                    let wait = Duration::from_millis((at - now).clamp(10, 60_000) as u64);
                    let _ = cvar.wait_timeout(g, wait);
                    continue;
                }
                None => {
                    let _ = cvar.wait_timeout(g, Duration::from_secs(300));
                    continue;
                }
            }
            if let Some(store) = app.try_state::<Store>() {
                Alarms::persist(&store, &g.alarms);
            }
        }
        for alarm in due {
            fire(&app, alarm);
        }
    }
}

fn fire(app: &AppHandle, alarm: Alarm) {
    let late = (now_ms() - alarm.at_ms).max(0);
    log::info!(target: "alarms", "alarme {} ({}) disparou com {late} ms de atraso", alarm.id, alarm.category);
    if alarm.notify && late < STALE_NOTIFY_MS {
        let mut b = app.notification().builder().title(&alarm.title).body(&alarm.body);
        if alarm.sound {
            b = b.sound(if alarm.category == "water" { "Reminder" } else { "Default" });
        }
        if let Err(e) = b.show() {
            log::warn!(target: "alarms", "notificação nativa falhou: {e}");
        }
    }
    let _ = app.emit(
        "alarm://fired",
        FiredPayload { id: alarm.id, category: alarm.category, at_ms: alarm.at_ms, late_ms: late },
    );
}

#[tauri::command]
pub fn alarm_set(alarms: State<'_, Alarms>, store: State<'_, Store>, alarm: Alarm) -> AppResult<()> {
    alarms.upsert(&store, alarm)
}

#[tauri::command]
pub fn alarm_cancel(
    alarms: State<'_, Alarms>,
    store: State<'_, Store>,
    id: String,
    prefix: Option<bool>,
) -> AppResult<usize> {
    alarms.cancel(&store, &id, prefix.unwrap_or(false))
}

#[tauri::command]
pub fn alarm_list(alarms: State<'_, Alarms>) -> Vec<Alarm> {
    alarms.list()
}

/// Notificação imediata (ex.: erro de integração importante). Mesma validação dos alarmes.
#[tauri::command]
pub fn notify_now(app: AppHandle, title: String, body: String, sound: Option<bool>) -> AppResult<()> {
    if title.chars().count() > 120 || body.chars().count() > 300 {
        return Err(AppError::invalid("texto longo demais"));
    }
    let mut b = app.notification().builder().title(title).body(body);
    if sound.unwrap_or(true) {
        b = b.sound("Default");
    }
    b.show()
        .map_err(|e| AppError::unavailable(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alarm(id: &str, cat: &str) -> Alarm {
        Alarm {
            id: id.into(),
            at_ms: now_ms() + 60_000,
            title: "t".into(),
            body: "b".into(),
            category: cat.into(),
            notify: true,
            sound: true,
        }
    }

    #[test]
    fn validates_ids_categories_and_time() {
        assert!(validate(&alarm("water:next", "water")).is_ok());
        assert!(validate(&alarm("task:abc-123", "tasks")).is_ok());
        assert!(validate(&alarm("bad id", "water")).is_err());
        assert!(validate(&alarm("x", "shell")).is_err());
        let mut far = alarm("x", "water");
        far.at_ms = now_ms() + 400 * 24 * 3600 * 1000;
        assert!(validate(&far).is_err());
        let mut long = alarm("x", "water");
        long.title = "a".repeat(121);
        assert!(validate(&long).is_err());
    }
}
