//! Abrir e mostrar arquivos (resultados do conversor e do downloader).
//!
//! Caminhos vindos do frontend são tratados como não confiáveis: são canonicalizados,
//! conferidos e nunca usados para escrever fora da pasta de dados do VANTA.
//! Por padrão a Shelf guarda só a referência — nada é copiado ou movido sem o usuário pedir.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};

const EXECUTABLE_EXT: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "scr", "lnk", "url", "hta", "cpl",
    "msc", "reg", "jar",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    pub ext: String,
    pub executable: bool,
}

pub fn is_executable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXECUTABLE_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn checked(path: &str) -> AppResult<PathBuf> {
    if path.is_empty() || path.len() > 2000 || path.contains('\0') {
        return Err(AppError::invalid("caminho inválido"));
    }
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(AppError::invalid("caminho precisa ser absoluto"));
    }
    // UNC/rede: não abrimos automaticamente um caminho remoto vindo de dados persistidos.
    if path.starts_with(r"\\") && !path.starts_with(r"\\?\") {
        return Err(AppError::invalid("caminhos de rede não são suportados na Shelf"));
    }
    Ok(p)
}

fn stat_one(path: &str) -> FileStat {
    let p = PathBuf::from(path);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
    let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let meta = checked(path).ok().and_then(|p| fs::metadata(p).ok());
    FileStat {
        path: path.to_string(),
        name,
        exists: meta.is_some(),
        is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
        size: meta.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
        modified_ms: meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64),
        executable: is_executable(&p),
        ext,
    }
}

#[tauri::command]
pub fn files_stat(paths: Vec<String>) -> AppResult<Vec<FileStat>> {
    if paths.len() > 200 {
        return Err(AppError::invalid("itens demais"));
    }
    Ok(paths.iter().map(|p| stat_one(p)).collect())
}

#[tauri::command]
pub fn files_open(app: AppHandle, path: String, confirmed_executable: Option<bool>) -> AppResult<()> {
    let p = checked(&path)?;
    let canonical = p.canonicalize().map_err(|_| AppError::new("missing", "o arquivo não existe mais"))?;
    if is_executable(&canonical) && confirmed_executable != Some(true) {
        return Err(AppError::new("needs_confirmation", "arquivo executável: confirme antes de abrir"));
    }
    app.opener()
        .open_path(canonical.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::io(e.to_string()))
}

#[tauri::command]
pub fn files_reveal(app: AppHandle, path: String) -> AppResult<()> {
    let p = checked(&path)?;
    let canonical = p.canonicalize().map_err(|_| AppError::new("missing", "o arquivo não existe mais"))?;
    app.opener().reveal_item_in_dir(canonical).map_err(|e| AppError::io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_executables_case_insensitively() {
        assert!(is_executable(Path::new("C:\\x\\setup.EXE")));
        assert!(is_executable(Path::new("C:\\x\\run.ps1")));
        assert!(!is_executable(Path::new("C:\\x\\photo.png")));
    }

    #[test]
    fn rejects_relative_network_and_nul_paths() {
        assert!(checked("relative\\file.txt").is_err());
        assert!(checked("\\\\server\\share\\a.txt").is_err());
        assert!(checked("C:\\a\0b").is_err());
        assert!(checked("C:\\Users\\x\\a.txt").is_ok());
    }
}
