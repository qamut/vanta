//! Laço de mídia por leitura periódica, usado no Linux (MPRIS) e no macOS (AppleScript).
//!
//! O Windows avisa por eventos; aqui não há eventos confiáveis para tudo, então o laço relê
//! as sessões a cada ~1 s enquanto algo toca (3 s parado). Para não emitir um snapshot por
//! segundo só porque a posição andou, uma linha do tempo que bate com a anterior extrapolada
//! (±1,5 s) é mantida como estava: o frontend já interpola a partir de `updated_at_ms`.

use std::collections::HashMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use super::model::{MediaAction, MediaSession, MediaSnapshot, PlaybackStatus, Timeline};
use super::{ArtCache, Msg};
use crate::error::AppError;

pub struct Read {
    pub sessions: Vec<MediaSession>,
    pub current: Option<String>,
    /// Capas novas: (chave, data URL).
    pub art: Vec<(String, String)>,
}

pub trait Backend {
    fn read(&mut self) -> Result<Read, String>;
    fn command(&mut self, id: &str, action: MediaAction, position_ms: Option<i64>, current: Option<&MediaSession>) -> Result<(), String>;
}

/// A linha do tempo nova só conta como mudança se fugir da anterior extrapolada.
pub fn keep_timeline(old: &MediaSession, new: &MediaSession, now_ms: i64) -> bool {
    let (Some(a), Some(b)) = (&old.timeline, &new.timeline) else { return false };
    if old.status != new.status || old.title != new.title || a.end_ms != b.end_ms {
        return false;
    }
    let expected = if old.status == PlaybackStatus::Playing { a.position_ms + (now_ms - a.updated_at_ms) } else { a.position_ms };
    (expected - b.position_ms).abs() < 1500
}

pub fn timeline(position_ms: i64, length_ms: i64, can_seek: bool, now_ms: i64) -> Option<Timeline> {
    (length_ms > 0).then(|| Timeline {
        start_ms: 0,
        end_ms: length_ms,
        position_ms: position_ms.clamp(0, length_ms),
        updated_at_ms: now_ms,
        min_seek_ms: 0,
        max_seek_ms: if can_seek { length_ms } else { 0 },
    })
}

pub fn run<B: Backend>(app: AppHandle, rx: Receiver<Msg>, snapshot: Arc<Mutex<MediaSnapshot>>, art: Arc<Mutex<ArtCache>>, mut backend: B) {
    let mut revision = 0u64;
    loop {
        let now = crate::alarms::now_ms();
        let mut snap = match backend.read() {
            Ok(r) => {
                if let Ok(mut cache) = art.lock() {
                    for (k, v) in r.art {
                        cache.insert(k, v);
                    }
                }
                MediaSnapshot { available: true, error: None, sessions: r.sessions, system_current_id: r.current, revision: 0 }
            }
            Err(e) => MediaSnapshot { available: false, error: Some(e), ..Default::default() },
        };
        let changed = match snapshot.lock() {
            Ok(cur) => {
                let old: HashMap<&str, &MediaSession> = cur.sessions.iter().map(|s| (s.id.as_str(), s)).collect();
                for s in &mut snap.sessions {
                    if let Some(o) = old.get(s.id.as_str()) {
                        if keep_timeline(o, s, now) {
                            s.timeline = o.timeline.clone();
                        }
                    }
                }
                let mut a = cur.clone();
                a.revision = 0;
                a != snap
            }
            Err(_) => return,
        };
        if changed {
            revision += 1;
            snap.revision = revision;
            if let Ok(mut cur) = snapshot.lock() {
                *cur = snap.clone();
            }
            let _ = app.emit("media://snapshot", snap);
        }

        let playing = snapshot.lock().map(|s| s.sessions.iter().any(|x| x.status == PlaybackStatus::Playing)).unwrap_or(false);
        let wait = if playing { Duration::from_millis(1000) } else { Duration::from_millis(3000) };
        match rx.recv_timeout(wait) {
            Ok(Msg::Command { id, action, position_ms, reply }) => {
                let current = snapshot.lock().ok().and_then(|s| s.sessions.iter().find(|x| x.id == id).cloned());
                let r = backend.command(&id, action, position_ms, current.as_ref()).map_err(AppError::unavailable);
                let _ = reply.send(r);
                // Uma releitura logo depois do comando deixa o botão responder na hora.
                std::thread::sleep(Duration::from_millis(150));
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Baixa uma capa remota (https, até 3 MB) com o curl do sistema.
pub fn fetch_art(url: &str) -> Option<Vec<u8>> {
    if !url.starts_with("https://") || url.len() > 2048 || url.contains(char::is_whitespace) {
        return None;
    }
    let out = std::process::Command::new("curl")
        .args(["-L", "--fail", "--silent", "--max-time", "6", "--max-filesize", "3145728", "--", url])
        .output()
        .ok()?;
    (out.status.success() && !out.stdout.is_empty()).then_some(out.stdout)
}

/// Só aceita formatos de imagem reais (pelos bytes).
pub fn art_data_url(bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::model::{Controls, PlaybackKind};
    use crate::media::names::{AppIdentity, SourceKind};

    fn session(status: PlaybackStatus, pos: i64, at: i64) -> MediaSession {
        MediaSession {
            id: "spotify#0".into(),
            app_id: "spotify".into(),
            app: AppIdentity { name: "Spotify".into(), kind: SourceKind::App, brand: "spotify".into(), resolved_by: "table" },
            title: "Luz de Neon".into(),
            artist: String::new(),
            album: String::new(),
            album_artist: String::new(),
            subtitle: String::new(),
            track_number: 0,
            kind: PlaybackKind::Music,
            status,
            controls: Controls::default(),
            timeline: timeline(pos, 200_000, true, at),
            rate: None,
            shuffle: None,
            repeat: None,
            artwork_key: None,
        }
    }

    #[test]
    fn a_linha_do_tempo_que_andou_no_ritmo_nao_conta_como_mudanca() {
        let old = session(PlaybackStatus::Playing, 10_000, 1_000);
        assert!(keep_timeline(&old, &session(PlaybackStatus::Playing, 11_100, 2_000), 2_000));
        // pulo de 20 s: foi um seek, tem que ir para o frontend
        assert!(!keep_timeline(&old, &session(PlaybackStatus::Playing, 31_000, 2_000), 2_000));
        // pausou: o estado mudou
        assert!(!keep_timeline(&old, &session(PlaybackStatus::Paused, 11_000, 2_000), 2_000));
    }

    #[test]
    fn so_imagens_de_verdade_viram_capa() {
        assert!(art_data_url(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().starts_with("data:image/jpeg"));
        assert!(art_data_url(b"<svg></svg>").is_none());
    }
}
