//! Linux: o que está tocando vem do MPRIS (org.mpris.MediaPlayer2.*) no barramento de sessão.
//!
//! Spotify, VLC, Rhythmbox, Elisa, Chrome, Firefox e quase todo player do Linux publicam ali.
//! Cada nome no barramento vira uma sessão; a identidade vem da propriedade `Identity`.

use std::collections::HashMap;

use zbus::blocking::fdo::DBusProxy;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedValue;

use super::model::{Controls, MediaAction, MediaSession, PlaybackKind, PlaybackStatus};
use super::names;
use super::poll::{self, Backend, Read};

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";

#[derive(Default)]
pub struct Mpris {
    conn: Option<Connection>,
    /// url da capa → chave já em cache
    art_keys: HashMap<String, String>,
}

fn string(meta: &HashMap<String, OwnedValue>, key: &str) -> String {
    meta.get(key).and_then(|v| String::try_from(v.try_clone().ok()?).ok()).unwrap_or_default()
}

fn strings(meta: &HashMap<String, OwnedValue>, key: &str) -> String {
    meta.get(key)
        .and_then(|v| Vec::<String>::try_from(v.try_clone().ok()?).ok())
        .map(|v| v.join(", "))
        .unwrap_or_else(|| string(meta, key))
}

fn length_us(meta: &HashMap<String, OwnedValue>) -> i64 {
    let Some(v) = meta.get("mpris:length") else { return 0 };
    let v = || v.try_clone().ok();
    v().and_then(|x| i64::try_from(x).ok()).or_else(|| v().and_then(|x| u64::try_from(x).ok()).map(|u| u as i64)).unwrap_or(0)
}

impl Mpris {
    fn conn(&mut self) -> Result<&Connection, String> {
        if self.conn.is_none() {
            self.conn = Some(Connection::session().map_err(|e| format!("D-Bus indisponível: {e}"))?);
        }
        Ok(self.conn.as_ref().expect("conexão"))
    }

    fn proxy<'a>(conn: &'a Connection, name: &'a str, iface: &'a str) -> Option<Proxy<'a>> {
        Proxy::new(conn, name, PATH, iface).ok()
    }

    fn art(&mut self, url: &str) -> (Option<String>, Option<(String, String)>) {
        if url.is_empty() {
            return (None, None);
        }
        if let Some(k) = self.art_keys.get(url) {
            return (Some(k.clone()), None);
        }
        let bytes = if let Some(path) = url.strip_prefix("file://") {
            let path = path.replace("%20", " ");
            std::fs::metadata(&path).ok().filter(|m| m.len() <= 3 * 1024 * 1024).and_then(|_| std::fs::read(&path).ok())
        } else {
            poll::fetch_art(url)
        };
        match bytes.and_then(|b| poll::art_data_url(&b)) {
            Some(data) => {
                let key = super::hash_bytes(url.as_bytes());
                self.art_keys.insert(url.to_string(), key.clone());
                (Some(key.clone()), Some((key, data)))
            }
            None => (None, None),
        }
    }
}

impl Backend for Mpris {
    fn read(&mut self) -> Result<Read, String> {
        let now = crate::alarms::now_ms();
        let names: Vec<String> = {
            let conn = self.conn()?;
            let dbus = DBusProxy::new(conn).map_err(|e| e.to_string())?;
            match dbus.list_names() {
                Ok(list) => list.into_iter().map(|n| n.to_string()).filter(|n| n.starts_with(PREFIX)).collect(),
                Err(e) => {
                    self.conn = None;
                    return Err(format!("D-Bus: {e}"));
                }
            }
        };
        let mut sessions = Vec::new();
        let mut art = Vec::new();
        for name in names {
            let conn = self.conn()?.clone();
            let (Some(root), Some(player)) = (Self::proxy(&conn, &name, "org.mpris.MediaPlayer2"), Self::proxy(&conn, &name, PLAYER)) else { continue };
            let status = match player.get_property::<String>("PlaybackStatus").unwrap_or_default().as_str() {
                "Playing" => PlaybackStatus::Playing,
                "Paused" => PlaybackStatus::Paused,
                "Stopped" => PlaybackStatus::Stopped,
                _ => continue,
            };
            let meta: HashMap<String, OwnedValue> = player.get_property("Metadata").unwrap_or_default();
            let title = string(&meta, "xesam:title");
            if title.is_empty() && status == PlaybackStatus::Stopped {
                continue;
            }
            let identity: String = root.get_property("Identity").unwrap_or_default();
            // "org.mpris.MediaPlayer2.chromium.instance123" -> "chromium"
            let app_id = name.trim_start_matches(PREFIX).split('.').next().unwrap_or_default().to_string();
            let flag = |p: &str| player.get_property::<bool>(p).unwrap_or(false);
            let (can_play, can_pause, can_next, can_prev, can_seek) = (flag("CanPlay"), flag("CanPause"), flag("CanGoNext"), flag("CanGoPrevious"), flag("CanSeek"));
            let position_us: i64 = player.get_property("Position").unwrap_or(0);
            let (artwork_key, new_art) = self.art(&string(&meta, "mpris:artUrl"));
            art.extend(new_art);
            let url = string(&meta, "xesam:url");
            let video = url.contains("youtube.com/watch") || url.contains("netflix.com") || url.ends_with(".mp4") || url.ends_with(".mkv");
            sessions.push(MediaSession {
                id: format!("{name}#0"),
                app_id: app_id.clone(),
                app: names::identify(&app_id, Some(identity)),
                title,
                artist: strings(&meta, "xesam:artist"),
                album: string(&meta, "xesam:album"),
                album_artist: strings(&meta, "xesam:albumArtist"),
                subtitle: String::new(),
                track_number: 0,
                kind: if video { PlaybackKind::Video } else { PlaybackKind::Music },
                status,
                controls: Controls { play: can_play, pause: can_pause, toggle: can_play || can_pause, next: can_next, previous: can_prev, seek: can_seek, shuffle: false, repeat: false },
                timeline: poll::timeline(position_us / 1000, length_us(&meta) / 1000, can_seek, now),
                rate: None,
                shuffle: None,
                repeat: None,
                artwork_key,
            });
        }
        let current = sessions.iter().find(|s| s.status == PlaybackStatus::Playing).or(sessions.first()).map(|s| s.id.clone());
        Ok(Read { sessions, current, art })
    }

    fn command(&mut self, id: &str, action: MediaAction, position_ms: Option<i64>, current: Option<&MediaSession>) -> Result<(), String> {
        let name = id.split('#').next().unwrap_or(id).to_string();
        if !name.starts_with(PREFIX) {
            return Err("sessão desconhecida".into());
        }
        let conn = self.conn()?.clone();
        let player = Self::proxy(&conn, &name, PLAYER).ok_or("player indisponível")?;
        let r = match action {
            MediaAction::Play => player.call_method("Play", &()),
            MediaAction::Pause => player.call_method("Pause", &()),
            MediaAction::Toggle => player.call_method("PlayPause", &()),
            MediaAction::Next => player.call_method("Next", &()),
            MediaAction::Previous => player.call_method("Previous", &()),
            MediaAction::Seek => {
                // Seek é relativo (µs): evita depender do TrackId que SetPosition exige.
                let now_pos = player.get_property::<i64>("Position").unwrap_or_else(|_| current.and_then(|c| c.timeline.as_ref()).map(|t| t.position_ms * 1000).unwrap_or(0));
                let target = position_ms.unwrap_or(0) * 1000;
                player.call_method("Seek", &(target - now_pos))
            }
        };
        r.map(|_| ()).map_err(|e| e.to_string())
    }
}
