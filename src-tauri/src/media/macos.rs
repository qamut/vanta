//! macOS: o que está tocando no Spotify e no Música, por AppleScript.
//!
//! O framework privado que o Centro de Controle usa (MediaRemote) foi fechado para apps de
//! terceiros no macOS 15.4, então a fonte é o AppleScript de cada player. O `pgrep` vem antes
//! para nunca abrir um app que está fechado (um `tell application` abriria). Na primeira vez o
//! macOS pergunta se o VANTA pode controlar o app (NSAppleEventsUsageDescription no Info.plist).

use std::collections::HashMap;
use std::process::Command;

use super::model::{Controls, MediaAction, MediaSession, PlaybackKind, PlaybackStatus};
use super::names::{AppIdentity, SourceKind};
use super::poll::{self, Backend, Read};

const SEP: char = '\u{1f}';

pub struct Player {
    pub key: &'static str,
    pub bundle: &'static str,
    pub process: &'static str,
    pub name: &'static str,
    pub brand: &'static str,
}

pub const PLAYERS: &[Player] = &[
    Player { key: "spotify", bundle: "com.spotify.client", process: "Spotify", name: "Spotify", brand: "spotify" },
    Player { key: "music", bundle: "com.apple.Music", process: "Music", name: "Apple Music", brand: "apple-music" },
];

/// Uma linha por player: estado, título, artista, álbum, duração (ms), posição (ms), capa (url).
fn script(p: &Player) -> String {
    // Spotify dá a duração em ms; o Música, em segundos.
    let duration = if p.key == "spotify" { "(duration of t)" } else { "((duration of t) * 1000)" };
    let art = if p.key == "spotify" { "(artwork url of t)" } else { "\"\"" };
    format!(
        r#"set s to character id 31
tell application id "{bundle}"
  set st to (player state as text)
  if st is "stopped" then return st
  set t to current track
  return st & s & (name of t) & s & (artist of t) & s & (album of t) & s & ({duration} as integer as text) & s & ((player position * 1000) as integer as text) & s & {art}
end tell"#,
        bundle = p.bundle
    )
}

#[derive(Debug, PartialEq)]
pub struct Line {
    pub status: PlaybackStatus,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub position_ms: i64,
    pub art_url: String,
}

pub fn parse_line(out: &str) -> Option<Line> {
    let out = out.trim_end_matches(['\n', '\r']);
    let f: Vec<&str> = out.split(SEP).collect();
    let status = match f.first()?.trim() {
        "playing" => PlaybackStatus::Playing,
        "paused" => PlaybackStatus::Paused,
        _ => return None,
    };
    if f.len() < 7 {
        return None;
    }
    let num = |s: &str| s.trim().replace(',', ".").parse::<f64>().ok().map(|v| v.round() as i64).unwrap_or(0);
    Some(Line {
        status,
        title: f[1].to_string(),
        artist: f[2].to_string(),
        album: f[3].to_string(),
        duration_ms: num(f[4]).max(0),
        position_ms: num(f[5]).max(0),
        art_url: f[6].trim().to_string(),
    })
}

fn running(process: &str) -> bool {
    Command::new("pgrep").args(["-x", process]).output().map(|o| o.status.success()).unwrap_or(false)
}

fn osascript(src: &str) -> Result<String, String> {
    let out = Command::new("osascript").args(["-e", src]).output().map_err(|e| format!("osascript indisponível: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(Default)]
pub struct AppleScript {
    /// url da capa → chave já em cache
    art_keys: HashMap<String, String>,
}

impl Backend for AppleScript {
    fn read(&mut self) -> Result<Read, String> {
        let now = crate::alarms::now_ms();
        let mut sessions = Vec::new();
        let mut art = Vec::new();
        for p in PLAYERS {
            if !running(p.process) {
                continue;
            }
            // Sem permissão de automação o osascript falha: a sessão só não aparece.
            let Ok(out) = osascript(&script(p)) else { continue };
            let Some(l) = parse_line(&out) else { continue };
            let artwork_key = if l.art_url.is_empty() {
                None
            } else if let Some(k) = self.art_keys.get(&l.art_url) {
                Some(k.clone())
            } else {
                let url = poll::fetch_art(&l.art_url).and_then(|b| poll::art_data_url(&b));
                url.map(|data| {
                    let key = super::hash_bytes(l.art_url.as_bytes());
                    art.push((key.clone(), data));
                    self.art_keys.insert(l.art_url.clone(), key.clone());
                    key
                })
            };
            sessions.push(MediaSession {
                id: format!("{}#0", p.bundle),
                app_id: p.bundle.into(),
                app: AppIdentity { name: p.name.into(), kind: SourceKind::App, brand: p.brand.into(), resolved_by: "table" },
                title: l.title,
                artist: l.artist,
                album: l.album,
                album_artist: String::new(),
                subtitle: String::new(),
                track_number: 0,
                kind: PlaybackKind::Music,
                status: l.status,
                controls: Controls { play: true, pause: true, toggle: true, next: true, previous: true, seek: true, shuffle: false, repeat: false },
                timeline: poll::timeline(l.position_ms, l.duration_ms, true, now),
                rate: None,
                shuffle: None,
                repeat: None,
                artwork_key,
            });
        }
        let current = sessions.iter().find(|s| s.status == PlaybackStatus::Playing).or(sessions.first()).map(|s| s.id.clone());
        Ok(Read { sessions, current, art })
    }

    fn command(&mut self, id: &str, action: MediaAction, position_ms: Option<i64>, _current: Option<&MediaSession>) -> Result<(), String> {
        let bundle = id.split('#').next().unwrap_or(id);
        let p = PLAYERS.iter().find(|p| p.bundle == bundle).ok_or("sessão desconhecida")?;
        let verb = match action {
            MediaAction::Play => "play".to_string(),
            MediaAction::Pause => "pause".to_string(),
            MediaAction::Toggle => "playpause".to_string(),
            MediaAction::Next => "next track".to_string(),
            MediaAction::Previous => "previous track".to_string(),
            MediaAction::Seek => format!("set player position to {}", position_ms.unwrap_or(0) as f64 / 1000.0),
        };
        osascript(&format!("tell application id \"{}\" to {verb}", p.bundle)).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_a_linha_do_spotify() {
        let l = parse_line("playing\u{1f}Luz de Neon\u{1f}Aurora Sul\u{1f}Madrugada\u{1f}203000\u{1f}39200\u{1f}https://i.scdn.co/image/x\n").unwrap();
        assert_eq!(l.status, PlaybackStatus::Playing);
        assert_eq!((l.duration_ms, l.position_ms), (203_000, 39_200));
        assert_eq!(l.art_url, "https://i.scdn.co/image/x");
    }

    #[test]
    fn parado_ou_lixo_nao_vira_sessao() {
        assert!(parse_line("stopped").is_none());
        assert!(parse_line("playing\u{1f}só o título").is_none());
    }

    #[test]
    fn numero_com_virgula_decimal_tambem_serve() {
        let l = parse_line("paused\u{1f}a\u{1f}b\u{1f}c\u{1f}180000\u{1f}1234,5\u{1f}").unwrap();
        assert_eq!(l.position_ms, 1235);
    }
}
