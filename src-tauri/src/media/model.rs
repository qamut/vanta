use serde::{Deserialize, Serialize};

use super::names::AppIdentity;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    Closed,
    Opened,
    Changing,
    Stopped,
    Playing,
    Paused,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackKind {
    Music,
    Video,
    Image,
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Controls {
    pub play: bool,
    pub pause: bool,
    pub toggle: bool,
    pub next: bool,
    pub previous: bool,
    pub seek: bool,
    pub shuffle: bool,
    pub repeat: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub start_ms: i64,
    pub end_ms: i64,
    pub position_ms: i64,
    /// Instante (Unix ms) em que `position_ms` era verdade. O frontend interpola a partir daqui.
    pub updated_at_ms: i64,
    pub min_seek_ms: i64,
    pub max_seek_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    /// AUMID + "#" + ordinal entre sessões do mesmo AUMID (ex.: duas abas do Chrome).
    pub id: String,
    pub app_id: String,
    pub app: AppIdentity,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub subtitle: String,
    pub track_number: i32,
    pub kind: PlaybackKind,
    pub status: PlaybackStatus,
    pub controls: Controls,
    pub timeline: Option<Timeline>,
    pub rate: Option<f64>,
    pub shuffle: Option<bool>,
    /// "none" | "track" | "list"
    pub repeat: Option<String>,
    /// Hash do conteúdo da capa; o dado em si é pedido à parte (`media_artwork`).
    pub artwork_key: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    /// A API de sessões do Windows respondeu.
    pub available: bool,
    pub error: Option<String>,
    pub sessions: Vec<MediaSession>,
    /// A sessão que o próprio Windows considera atual.
    pub system_current_id: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaAction {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Seek,
}

/// Conversões do relógio do Windows (intervalos de 100 ns).
pub fn ticks_to_ms(ticks: i64) -> i64 {
    ticks / 10_000
}

/// `DateTime.UniversalTime` (100 ns desde 1601-01-01) -> Unix ms.
pub fn filetime_to_unix_ms(universal: i64) -> i64 {
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
    if universal <= 0 {
        return 0;
    }
    (universal - EPOCH_DIFF) / 10_000
}

/// Ordinais estáveis para sessões com o mesmo AUMID.
pub fn assign_ids<'a>(aumids: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut seen: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    aumids
        .into_iter()
        .map(|a| {
            let n = seen.entry(a).or_insert(0);
            let id = format!("{a}#{n}");
            *n += 1;
            id
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_windows_clock() {
        assert_eq!(ticks_to_ms(10_000_000), 1000);
        assert_eq!(filetime_to_unix_ms(116_444_736_000_000_000), 0);
        assert_eq!(filetime_to_unix_ms(116_444_736_000_000_000 + 10_000 * 1500), 1500);
        assert_eq!(filetime_to_unix_ms(0), 0);
    }

    #[test]
    fn same_app_sessions_get_distinct_ordinals() {
        let ids = assign_ids(["Chrome", "Spotify.exe", "Chrome"]);
        assert_eq!(ids, vec!["Chrome#0", "Spotify.exe#0", "Chrome#1"]);
    }
}
