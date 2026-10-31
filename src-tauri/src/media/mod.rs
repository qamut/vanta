//! Central de mídia: sessões do Windows (GlobalSystemMediaTransportControls); no Linux, o
//! MPRIS (linux.rs); no macOS, o AppleScript do Spotify e do Música (macos.rs).
//!
//! Uma thread dedicada (apartamento MTA) possui o gerenciador de sessões. Os eventos
//! nativos (sessões, propriedades, reprodução, linha do tempo) só marcam "sujo" num canal;
//! a thread agrupa rajadas (~90 ms), relê o estado e emite `media://snapshot` se algo mudou.
//! Comandos do frontend entram pelo mesmo canal, então nunca há duas leituras concorrentes.
//! Não há polling de progresso: o frontend interpola a posição a partir de `updatedAtMs`.

pub mod model;
pub mod names;
// O laço por leitura e o leitor do macOS (processos do sistema) compilam em todo lugar, para os
// testes rodarem no Windows; só são usados fora dele.
#[cfg(target_os = "linux")]
mod linux;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod macos;
#[cfg_attr(windows, allow(dead_code))]
mod poll;

use std::collections::{HashMap, VecDeque};
use std::sync::mpsc::{self, Sender};
#[cfg(windows)]
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use tauri::Emitter;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use model::{MediaAction, MediaSnapshot};

const ART_CACHE_LIMIT: usize = 16;
const ART_MAX_BYTES: u32 = 3 * 1024 * 1024;

enum Msg {
    Dirty { sessions: bool, props: bool },
    Command { id: String, action: MediaAction, position_ms: Option<i64>, reply: Sender<AppResult<()>> },
    Refresh,
}

#[derive(Default)]
pub struct ArtCache {
    order: VecDeque<String>,
    data: HashMap<String, String>,
}

impl ArtCache {
    fn insert(&mut self, key: String, url: String) {
        if self.data.contains_key(&key) {
            return;
        }
        self.order.push_back(key.clone());
        self.data.insert(key, url);
        while self.order.len() > ART_CACHE_LIMIT {
            if let Some(old) = self.order.pop_front() {
                self.data.remove(&old);
            }
        }
    }
}

pub struct Media {
    tx: Mutex<Sender<Msg>>,
    snapshot: Arc<Mutex<MediaSnapshot>>,
    art: Arc<Mutex<ArtCache>>,
}

pub fn start(app: &AppHandle) -> Media {
    let (tx, rx) = mpsc::channel();
    let snapshot = Arc::new(Mutex::new(MediaSnapshot::default()));
    let art = Arc::new(Mutex::new(ArtCache::default()));
    let (s2, a2, tx2, app2) = (snapshot.clone(), art.clone(), tx.clone(), app.clone());
    std::thread::Builder::new()
        .name("vanta-media".into())
        .spawn(move || {
            #[cfg(windows)]
            imp::run(app2, rx, tx2, s2, a2);
            #[cfg(target_os = "linux")]
            {
                drop(tx2);
                poll::run(app2, rx, s2, a2, linux::Mpris::default());
            }
            #[cfg(target_os = "macos")]
            {
                drop(tx2);
                poll::run(app2, rx, s2, a2, macos::AppleScript::default());
            }
        })
        .expect("thread de mídia");
    Media { tx: Mutex::new(tx), snapshot, art }
}

fn hash_bytes(bytes: &[u8]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{:016x}", h.finish())
}

#[tauri::command]
pub fn media_snapshot(media: State<'_, Media>) -> MediaSnapshot {
    media.snapshot.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn media_artwork(media: State<'_, Media>, key: String) -> Option<String> {
    media.art.lock().ok().and_then(|c| c.data.get(&key).cloned())
}

#[tauri::command]
pub async fn media_command(
    media: State<'_, Media>,
    id: String,
    action: MediaAction,
    position_ms: Option<i64>,
) -> AppResult<()> {
    if id.len() > 512 {
        return Err(AppError::invalid("id de sessão inválido"));
    }
    if action == MediaAction::Seek && !matches!(position_ms, Some(p) if p >= 0) {
        return Err(AppError::invalid("posição inválida"));
    }
    let (reply_tx, reply_rx) = mpsc::channel();
    media
        .tx
        .lock()
        .map_err(|_| AppError::io("canal"))?
        .send(Msg::Command { id, action, position_ms, reply: reply_tx })
        .map_err(|_| AppError::unavailable("serviço de mídia parado"))?;
    tauri::async_runtime::spawn_blocking(move || {
        reply_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|_| Err(AppError::unavailable("a sessão não respondeu a tempo")))
    })
    .await
    .map_err(|e| AppError::io(e.to_string()))?
}

#[tauri::command]
pub fn media_refresh(media: State<'_, Media>) {
    if let Ok(tx) = media.tx.lock() {
        let _ = tx.send(Msg::Refresh);
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use base64::Engine;
    use model::{Controls, MediaSession, PlaybackKind, PlaybackStatus, Timeline};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as GStatus, MediaPropertiesChangedEventArgs,
        PlaybackInfoChangedEventArgs, SessionsChangedEventArgs, TimelinePropertiesChangedEventArgs,
    };
    use windows::Media::{MediaPlaybackAutoRepeatMode, MediaPlaybackType};
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    struct Subscribed {
        session: Session,
        tokens: [i64; 3],
    }

    struct Worker {
        app: AppHandle,
        tx: Sender<Msg>,
        snapshot: Arc<Mutex<MediaSnapshot>>,
        art: Arc<Mutex<ArtCache>>,
        manager: Option<(Manager, [i64; 2])>,
        subs: Vec<Subscribed>,
        names: HashMap<String, names::AppIdentity>,
        /// Último hash de capa por id de sessão (evita reler a capa sem mudança de propriedades).
        art_by_session: HashMap<String, Option<String>>,
        revision: u64,
    }

    pub fn run(
        app: AppHandle,
        rx: Receiver<Msg>,
        tx: Sender<Msg>,
        snapshot: Arc<Mutex<MediaSnapshot>>,
        art: Arc<Mutex<ArtCache>>,
    ) {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let mut w = Worker {
            app,
            tx,
            snapshot,
            art,
            manager: None,
            subs: Vec::new(),
            names: HashMap::new(),
            art_by_session: HashMap::new(),
            revision: 0,
        };
        let mut need_sessions = true;
        let mut need_props = true;
        loop {
            if w.manager.is_none() {
                match w.connect() {
                    Ok(()) => {
                        need_sessions = true;
                        need_props = true;
                    }
                    Err(e) => {
                        log::warn!(target: "media", "GSMTC indisponível: {e}");
                        w.publish(MediaSnapshot {
                            available: false,
                            error: Some(e.message.clone()),
                            ..Default::default()
                        });
                        // Reconexão: tenta de novo em 20 s ou quando alguém pedir refresh.
                        match rx.recv_timeout(Duration::from_secs(20)) {
                            Ok(Msg::Command { reply, .. }) => {
                                let _ = reply.send(Err(AppError::unavailable("sessões de mídia indisponíveis")));
                            }
                            Err(RecvTimeoutError::Disconnected) => return,
                            _ => {}
                        }
                        continue;
                    }
                }
            }

            if let Err(e) = w.rebuild(need_sessions, need_props) {
                log::warn!(target: "media", "falha ao ler sessões ({e}); reconectando");
                w.disconnect();
                continue;
            }
            need_sessions = false;
            need_props = false;

            let any_playing = w
                .snapshot
                .lock()
                .map(|s| s.sessions.iter().any(|x| x.status == PlaybackStatus::Playing))
                .unwrap_or(false);
            // Sem polling de progresso: o tempo de espera só garante uma releitura de segurança
            // para apps que esquecem de emitir eventos de linha do tempo.
            let wait = if any_playing { Duration::from_secs(8) } else { Duration::from_secs(45) };
            match rx.recv_timeout(wait) {
                Ok(first) => {
                    let mut pending = vec![first];
                    // Agrupa a rajada de eventos que acompanha uma troca de faixa.
                    while let Ok(m) = rx.recv_timeout(Duration::from_millis(90)) {
                        pending.push(m);
                    }
                    for m in pending {
                        match m {
                            Msg::Dirty { sessions, props } => {
                                need_sessions |= sessions;
                                need_props |= props;
                            }
                            Msg::Refresh => {
                                need_sessions = true;
                                need_props = true;
                            }
                            Msg::Command { id, action, position_ms, reply } => {
                                let r = w.command(&id, action, position_ms);
                                let _ = reply.send(r);
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    impl Worker {
        fn connect(&mut self) -> AppResult<()> {
            let manager = Manager::RequestAsync()?.join()?;
            let tx1 = self.tx.clone();
            let t1 = manager.SessionsChanged(&TypedEventHandler::<Manager, SessionsChangedEventArgs>::new(
                move |_, _| {
                    let _ = tx1.send(Msg::Dirty { sessions: true, props: true });
                    Ok(())
                },
            ))?;
            let tx2 = self.tx.clone();
            let t2 = manager.CurrentSessionChanged(&TypedEventHandler::<Manager, CurrentSessionChangedEventArgs>::new(
                move |_, _| {
                    let _ = tx2.send(Msg::Dirty { sessions: false, props: false });
                    Ok(())
                },
            ))?;
            self.manager = Some((manager, [t1, t2]));
            log::info!(target: "media", "conectado ao gerenciador de sessões do Windows");
            Ok(())
        }

        fn disconnect(&mut self) {
            self.unsubscribe_sessions();
            if let Some((m, [t1, t2])) = self.manager.take() {
                let _ = m.RemoveSessionsChanged(t1);
                let _ = m.RemoveCurrentSessionChanged(t2);
            }
        }

        fn unsubscribe_sessions(&mut self) {
            for s in self.subs.drain(..) {
                let _ = s.session.RemoveMediaPropertiesChanged(s.tokens[0]);
                let _ = s.session.RemovePlaybackInfoChanged(s.tokens[1]);
                let _ = s.session.RemoveTimelinePropertiesChanged(s.tokens[2]);
            }
        }

        fn sessions(&self) -> AppResult<Vec<Session>> {
            let (m, _) = self.manager.as_ref().ok_or_else(|| AppError::unavailable("sem gerenciador"))?;
            let list = m.GetSessions()?;
            let mut out = Vec::new();
            for i in 0..list.Size()? {
                out.push(list.GetAt(i)?);
            }
            Ok(out)
        }

        fn subscribe(&mut self, sessions: &[Session]) {
            self.unsubscribe_sessions();
            for s in sessions {
                let tx_a = self.tx.clone();
                let tx_b = self.tx.clone();
                let tx_c = self.tx.clone();
                let a = s.MediaPropertiesChanged(&TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new(
                    move |_, _| {
                        let _ = tx_a.send(Msg::Dirty { sessions: false, props: true });
                        Ok(())
                    },
                ));
                let b = s.PlaybackInfoChanged(&TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new(
                    move |_, _| {
                        let _ = tx_b.send(Msg::Dirty { sessions: false, props: false });
                        Ok(())
                    },
                ));
                let c = s.TimelinePropertiesChanged(
                    &TypedEventHandler::<Session, TimelinePropertiesChangedEventArgs>::new(move |_, _| {
                        let _ = tx_c.send(Msg::Dirty { sessions: false, props: false });
                        Ok(())
                    }),
                );
                if let (Ok(a), Ok(b), Ok(c)) = (a, b, c) {
                    self.subs.push(Subscribed { session: s.clone(), tokens: [a, b, c] });
                }
            }
        }

        fn identity(&mut self, aumid: &str) -> names::AppIdentity {
            if let Some(id) = self.names.get(aumid) {
                return id.clone();
            }
            let id = names::identify(aumid, names::shell_display_name(aumid));
            log::info!(target: "media", "origem {aumid:?} -> {:?} ({})", id.name, id.resolved_by);
            self.names.insert(aumid.to_string(), id.clone());
            id
        }

        fn rebuild(&mut self, resubscribe: bool, reload_art: bool) -> AppResult<()> {
            let sessions = self.sessions()?;
            if resubscribe {
                self.subscribe(&sessions);
            }
            let aumids: Vec<String> =
                sessions.iter().map(|s| s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default()).collect();
            let ids = model::assign_ids(aumids.iter().map(|s| s.as_str()));

            let current_aumid = self
                .manager
                .as_ref()
                .and_then(|(m, _)| m.GetCurrentSession().ok())
                .and_then(|s| s.SourceAppUserModelId().ok())
                .map(|h| h.to_string());

            let mut out = Vec::with_capacity(sessions.len());
            for ((session, aumid), id) in sessions.iter().zip(aumids.iter()).zip(ids.iter()) {
                let app = self.identity(aumid);
                match self.read_session(session, id, aumid, app, reload_art) {
                    Ok(s) => out.push(s),
                    Err(e) => log::debug!(target: "media", "sessão {id} ilegível: {e}"),
                }
            }
            let live: std::collections::HashSet<&String> = ids.iter().collect();
            self.art_by_session.retain(|k, _| live.contains(k));

            // Para o Windows, a sessão atual é a primeira daquele AUMID.
            let system_current_id = current_aumid.and_then(|a| out.iter().find(|s| s.app_id == a).map(|s| s.id.clone()));
            self.publish(MediaSnapshot {
                available: true,
                error: None,
                sessions: out,
                system_current_id,
                revision: 0,
            });
            Ok(())
        }

        fn read_session(
            &mut self,
            s: &Session,
            id: &str,
            aumid: &str,
            app: names::AppIdentity,
            reload_art: bool,
        ) -> AppResult<MediaSession> {
            let pb = s.GetPlaybackInfo()?;
            let status = match pb.PlaybackStatus()? {
                GStatus::Playing => PlaybackStatus::Playing,
                GStatus::Paused => PlaybackStatus::Paused,
                GStatus::Stopped => PlaybackStatus::Stopped,
                GStatus::Changing => PlaybackStatus::Changing,
                GStatus::Opened => PlaybackStatus::Opened,
                GStatus::Closed => PlaybackStatus::Closed,
                _ => PlaybackStatus::Unknown,
            };
            let c = pb.Controls()?;
            let controls = Controls {
                play: c.IsPlayEnabled().unwrap_or(false),
                pause: c.IsPauseEnabled().unwrap_or(false),
                toggle: c.IsPlayPauseToggleEnabled().unwrap_or(false),
                next: c.IsNextEnabled().unwrap_or(false),
                previous: c.IsPreviousEnabled().unwrap_or(false),
                seek: c.IsPlaybackPositionEnabled().unwrap_or(false),
                shuffle: c.IsShuffleEnabled().unwrap_or(false),
                repeat: c.IsRepeatEnabled().unwrap_or(false),
            };
            let rate = pb.PlaybackRate().and_then(|r| r.Value()).ok();
            let shuffle = pb.IsShuffleActive().and_then(|r| r.Value()).ok();
            let repeat = pb.AutoRepeatMode().and_then(|r| r.Value()).ok().map(|m| {
                match m {
                    MediaPlaybackAutoRepeatMode::Track => "track",
                    MediaPlaybackAutoRepeatMode::List => "list",
                    _ => "none",
                }
                .to_string()
            });

            let timeline = s.GetTimelineProperties().ok().and_then(|tl| {
                let start = model::ticks_to_ms(tl.StartTime().ok()?.Duration);
                let end = model::ticks_to_ms(tl.EndTime().ok()?.Duration);
                if end <= start {
                    return None;
                }
                let now = crate::alarms::now_ms();
                let mut updated = model::filetime_to_unix_ms(tl.LastUpdatedTime().map(|d| d.UniversalTime).unwrap_or(0));
                if updated <= 0 || updated > now + 5_000 {
                    updated = now;
                }
                Some(Timeline {
                    start_ms: start,
                    end_ms: end,
                    position_ms: model::ticks_to_ms(tl.Position().ok()?.Duration),
                    updated_at_ms: updated,
                    min_seek_ms: model::ticks_to_ms(tl.MinSeekTime().map(|t| t.Duration).unwrap_or(0)),
                    max_seek_ms: model::ticks_to_ms(tl.MaxSeekTime().map(|t| t.Duration).unwrap_or(0)),
                })
            });

            // Algumas sessões (aba recém-aberta, player fechando) recusam as propriedades.
            let props = s.TryGetMediaPropertiesAsync().and_then(|op| op.join()).ok();
            let text = |f: &dyn Fn() -> windows_core::Result<windows_core::HSTRING>| f().map(|h| h.to_string()).unwrap_or_default();
            let (title, artist, album, album_artist, subtitle, track_number, kind) = match &props {
                Some(p) => (
                    text(&|| p.Title()),
                    text(&|| p.Artist()),
                    text(&|| p.AlbumTitle()),
                    text(&|| p.AlbumArtist()),
                    text(&|| p.Subtitle()),
                    p.TrackNumber().unwrap_or(0),
                    match p.PlaybackType().and_then(|t| t.Value()) {
                        Ok(MediaPlaybackType::Music) => PlaybackKind::Music,
                        Ok(MediaPlaybackType::Video) => PlaybackKind::Video,
                        Ok(MediaPlaybackType::Image) => PlaybackKind::Image,
                        _ => PlaybackKind::Unknown,
                    },
                ),
                None => (String::new(), String::new(), String::new(), String::new(), String::new(), 0, PlaybackKind::Unknown),
            };

            let artwork_key = if reload_art || !self.art_by_session.contains_key(id) {
                let key = props.as_ref().and_then(|p| self.load_artwork(p));
                self.art_by_session.insert(id.to_string(), key.clone());
                key
            } else {
                self.art_by_session.get(id).cloned().flatten()
            };

            Ok(MediaSession {
                id: id.to_string(),
                app_id: aumid.to_string(),
                app,
                title,
                artist,
                album,
                album_artist,
                subtitle,
                track_number,
                kind,
                status,
                controls,
                timeline,
                rate,
                shuffle,
                repeat,
                artwork_key,
            })
        }

        fn load_artwork(
            &self,
            props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
        ) -> Option<String> {
            let thumb = props.Thumbnail().ok()?;
            let stream = thumb.OpenReadAsync().ok()?.join().ok()?;
            let size = stream.Size().ok()? as u32;
            if size == 0 || size > ART_MAX_BYTES {
                return None;
            }
            let content_type = stream.ContentType().map(|h| h.to_string()).unwrap_or_default();
            let reader = DataReader::CreateDataReader(&stream).ok()?;
            let loaded = reader.LoadAsync(size).ok()?.join().ok()?;
            let mut buf = vec![0u8; loaded as usize];
            reader.ReadBytes(&mut buf).ok()?;
            let mime = sniff_mime(&buf, &content_type)?;
            let key = hash_bytes(&buf);
            if let Ok(mut cache) = self.art.lock() {
                if !cache.data.contains_key(&key) {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
                    cache.insert(key.clone(), format!("data:{mime};base64,{b64}"));
                }
            }
            Some(key)
        }

        fn find(&self, id: &str) -> AppResult<Session> {
            let sessions = self.sessions()?;
            let aumids: Vec<String> =
                sessions.iter().map(|s| s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default()).collect();
            let ids = model::assign_ids(aumids.iter().map(|s| s.as_str()));
            ids.iter()
                .position(|x| x == id)
                .and_then(|i| sessions.into_iter().nth(i))
                .ok_or_else(|| AppError::new("session_gone", "a sessão de mídia não existe mais"))
        }

        fn command(&mut self, id: &str, action: MediaAction, position_ms: Option<i64>) -> AppResult<()> {
            let s = self.find(id)?;
            let accepted = match action {
                MediaAction::Play => s.TryPlayAsync()?.join()?,
                MediaAction::Pause => s.TryPauseAsync()?.join()?,
                MediaAction::Toggle => s.TryTogglePlayPauseAsync()?.join()?,
                MediaAction::Next => s.TrySkipNextAsync()?.join()?,
                MediaAction::Previous => s.TrySkipPreviousAsync()?.join()?,
                MediaAction::Seek => {
                    let ms = position_ms.unwrap_or(0).max(0);
                    s.TryChangePlaybackPositionAsync(ms.saturating_mul(10_000))?.join()?
                }
            };
            log::info!(target: "media", "comando {action:?} em {id}: {}", if accepted { "aceito" } else { "recusado" });
            let _ = self.tx.send(Msg::Dirty { sessions: false, props: false });
            if accepted {
                Ok(())
            } else {
                Err(AppError::new("rejected", "o aplicativo recusou o comando"))
            }
        }

        fn publish(&mut self, mut snap: MediaSnapshot) {
            let changed = match self.snapshot.lock() {
                Ok(cur) => {
                    let mut a = cur.clone();
                    a.revision = 0;
                    a != snap
                }
                Err(_) => return,
            };
            if !changed {
                return;
            }
            self.revision += 1;
            snap.revision = self.revision;
            if let Ok(mut cur) = self.snapshot.lock() {
                *cur = snap.clone();
            }
            let _ = self.app.emit("media://snapshot", snap);
        }
    }

    /// Só aceita formatos de imagem reais (pelos bytes), nunca o que o app declarar.
    fn sniff_mime(buf: &[u8], _declared: &str) -> Option<&'static str> {
        if buf.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some("image/jpeg")
        } else if buf.starts_with(&[0x89, b'P', b'N', b'G']) {
            Some("image/png")
        } else if buf.len() > 12 && &buf[0..4] == b"RIFF" && &buf[8..12] == b"WEBP" {
            Some("image/webp")
        } else if buf.starts_with(b"GIF8") {
            Some("image/gif")
        } else if buf.len() > 2 && buf.starts_with(b"BM") {
            Some("image/bmp")
        } else {
            None
        }
    }

    #[cfg(test)]
    mod tests {
        use super::sniff_mime;

        #[test]
        fn artwork_mime_comes_from_magic_bytes() {
            assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0], "image/png"), Some("image/jpeg"));
            assert_eq!(sniff_mime(b"\x89PNG\r\n", ""), Some("image/png"));
            assert_eq!(sniff_mime(b"<svg xmlns=", "image/svg+xml"), None);
            assert_eq!(sniff_mime(b"<html>", "image/jpeg"), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ArtCache;

    #[test]
    fn art_cache_is_bounded_lru() {
        let mut c = ArtCache::default();
        for i in 0..40 {
            c.insert(format!("k{i}"), "x".into());
        }
        assert_eq!(c.data.len(), super::ART_CACHE_LIMIT);
        assert!(!c.data.contains_key("k0"));
        assert!(c.data.contains_key("k39"));
    }
}
