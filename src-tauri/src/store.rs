//! Persistência local tipada por chave. Cada chave é um arquivo JSON em
//! `%APPDATA%/app.vanta.island/data/`, escrito de forma atômica (arquivo temporário + rename).
//! As chaves são uma lista fechada: o frontend não escolhe caminhos.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::error::{AppError, AppResult};

pub const KEYS: &[&str] = &[
    "settings",
    "tasks",
    "water",
    "notifications",
    "media-prefs",
    "layout",
];

const MAX_BYTES: usize = 2 * 1024 * 1024;

pub struct Store {
    dir: PathBuf,
    lock: Mutex<()>,
}

#[derive(Serialize, Clone)]
struct ChangedPayload<'a> {
    key: &'a str,
    source: &'a str,
}

impl Store {
    pub fn new(dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir, lock: Mutex::new(()) })
    }

    #[cfg(test)]
    pub fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    fn path_for(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.json"))
    }

    pub fn read(&self, key: &str) -> Option<Value> {
        let _g = self.lock.lock().ok()?;
        let path = self.path_for(key);
        let raw = fs::read(&path).ok()?;
        match serde_json::from_slice::<Value>(&raw) {
            Ok(v) => Some(v),
            Err(err) => {
                // Arquivo corrompido: preserva uma cópia para diagnóstico e recomeça do padrão.
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let backup = self.dir.join(format!("{key}.corrupt-{ts}.json"));
                log::warn!(target: "store", "chave {key} corrompida ({err}); cópia em {}", backup.display());
                let _ = fs::rename(&path, backup);
                None
            }
        }
    }

    pub fn write(&self, key: &str, value: &Value) -> AppResult<()> {
        let bytes = serde_json::to_vec_pretty(value)?;
        if bytes.len() > MAX_BYTES {
            return Err(AppError::invalid(format!("valor de '{key}' excede {MAX_BYTES} bytes")));
        }
        let _g = self.lock.lock().map_err(|_| AppError::io("lock envenenado"))?;
        let path = self.path_for(key);
        let tmp = self.dir.join(format!("{key}.json.tmp"));
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn remove(&self, key: &str) -> AppResult<()> {
        let _g = self.lock.lock().map_err(|_| AppError::io("lock envenenado"))?;
        let path = self.path_for(key);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn size_of(&self, key: &str) -> u64 {
        fs::metadata(self.path_for(key)).map(|m| m.len()).unwrap_or(0)
    }
}

pub fn validate_key(key: &str) -> AppResult<&str> {
    if KEYS.contains(&key) {
        Ok(key)
    } else {
        Err(AppError::invalid(format!("chave de armazenamento desconhecida: {key}")))
    }
}

#[tauri::command]
pub fn store_get(store: State<'_, Store>, key: String) -> AppResult<Option<Value>> {
    let key = validate_key(&key)?;
    Ok(store.read(key))
}

#[tauri::command]
pub fn store_set(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, Store>,
    key: String,
    value: Value,
) -> AppResult<()> {
    let key = validate_key(&key)?;
    store.write(key, &value)?;
    let _ = app.emit("store://changed", ChangedPayload { key, source: window.label() });
    Ok(())
}

#[tauri::command]
pub fn store_clear(app: AppHandle, store: State<'_, Store>, key: String) -> AppResult<()> {
    let key = validate_key(&key)?;
    store.remove(key)?;
    let _ = app.emit("store://changed", ChangedPayload { key, source: "system" });
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreUsage {
    pub key: String,
    pub bytes: u64,
}

#[tauri::command]
pub fn store_usage(store: State<'_, Store>) -> Vec<StoreUsage> {
    KEYS.iter()
        .map(|k| StoreUsage { key: (*k).to_string(), bytes: store.size_of(k) })
        .collect()
}

pub fn init(app: &AppHandle) -> AppResult<Store> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::io(e.to_string()))?
        .join("data");
    Store::new(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> Store {
        let dir = std::env::temp_dir().join(format!(
            "vanta-store-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Store::new(dir).unwrap()
    }

    #[test]
    fn roundtrip_and_atomic_replace() {
        let s = temp_store();
        assert!(s.read("tasks").is_none());
        s.write("tasks", &serde_json::json!({"v": 1})).unwrap();
        s.write("tasks", &serde_json::json!({"v": 2})).unwrap();
        assert_eq!(s.read("tasks").unwrap()["v"], 2);
        assert!(!s.dir().join("tasks.json.tmp").exists());
    }

    #[test]
    fn corrupt_file_is_quarantined() {
        let s = temp_store();
        fs::write(s.dir().join("water.json"), b"{not json").unwrap();
        assert!(s.read("water").is_none());
        assert!(!s.dir().join("water.json").exists());
        let quarantined = fs::read_dir(s.dir())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("water.corrupt-"));
        assert!(quarantined);
    }

    #[test]
    fn rejects_unknown_keys_and_huge_values() {
        assert!(validate_key("../../etc").is_err());
        assert!(validate_key("alarms").is_err(), "chave interna não pode vir do frontend");
        assert!(validate_key("settings").is_ok());
        let s = temp_store();
        let huge = Value::String("x".repeat(MAX_BYTES + 10));
        assert!(s.write("tasks", &huge).is_err());
    }
}
