use serde::Serialize;

/// Erro devolvido aos comandos do frontend. Serializa como `{ code, message }`
/// para que a interface possa mostrar uma explicação curta sem interpretar texto livre.
#[derive(Debug, Serialize, Clone)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::new("io", message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::new("serialization", e.to_string())
    }
}

#[cfg(windows)]
impl From<windows_core::Error> for AppError {
    fn from(e: windows_core::Error) -> Self {
        AppError::new("windows", format!("{} (0x{:08X})", e.message(), e.code().0))
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::new("tauri", e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
