//! Protocolo da ponte com a extensão de navegador.
//!
//! Navegador ⇄ host nativo: Native Messaging (u32 little-endian + JSON, stdin/stdout).
//! Host nativo ⇄ VANTA: pipe nomeado local, uma mensagem JSON por linha.
//! Toda mensagem vinda do navegador é validada aqui antes de chegar à interface:
//! tipos fechados, tamanhos máximos, domínios na lista de sites suportados, URL https.

use std::io::{Read, Write};

use serde::{Deserialize, Serialize};

pub const HOST_NAME: &str = "app.vanta.bridge";
pub const CHROMIUM_EXTENSION_ID: &str = "oljgdogjbdlpekdianjiekfmopfegkfp";
pub const FIREFOX_EXTENSION_ID: &str = "media-bridge@vanta.app";
/// O Chrome limita mensagens do host a 1 MB; as nossas são bem menores.
pub const MAX_FRAME: usize = 64 * 1024;

/// Sites para os quais a extensão tem permissão. Qualquer outro domínio é descartado.
pub const SUPPORTED_SITES: &[(&str, &str)] = &[
    ("music.youtube.com", "YouTube Music"),
    ("youtube.com", "YouTube"),
    ("netflix.com", "Netflix"),
    ("primevideo.com", "Prime Video"),
    ("amazon.com", "Prime Video"),
    ("amazon.com.br", "Prime Video"),
    ("open.spotify.com", "Spotify Web"),
    ("music.apple.com", "Apple Music"),
    ("twitch.tv", "Twitch"),
    ("soundcloud.com", "SoundCloud"),
    ("deezer.com", "Deezer"),
    ("tidal.com", "TIDAL"),
    ("disneyplus.com", "Disney+"),
    ("max.com", "Max"),
    ("globoplay.globo.com", "Globoplay"),
    ("vimeo.com", "Vimeo"),
];

pub fn site_for(domain: &str) -> Option<&'static str> {
    let d = domain.trim().trim_start_matches("www.").to_ascii_lowercase();
    SUPPORTED_SITES
        .iter()
        .find(|(s, _)| d == *s || d.ends_with(&format!(".{s}")))
        .map(|(_, name)| *name)
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TabReport {
    pub tab_id: i64,
    pub domain: String,
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub artwork_url: String,
    pub playing: bool,
    pub position_ms: Option<f64>,
    pub duration_ms: Option<f64>,
    #[serde(default)]
    pub can_seek: bool,
    #[serde(default)]
    pub can_next: bool,
    #[serde(default)]
    pub can_previous: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ExtMessage {
    #[serde(rename_all = "camelCase")]
    Hello { browser: String, version: String },
    Media(TabReport),
    #[serde(rename_all = "camelCase")]
    Gone { tab_id: i64 },
    Pong { nonce: u64 },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AppMessage {
    #[serde(rename_all = "camelCase")]
    Command { tab_id: i64, action: String, position_ms: Option<i64> },
    Ping { nonce: u64 },
}

/// Relatório de aba já validado e normalizado.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub key: String,
    pub browser: String,
    pub tab_id: i64,
    pub domain: String,
    pub site: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub url: String,
    pub artwork_url: String,
    pub playing: bool,
    pub position_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub can_seek: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub updated_at_ms: i64,
}

fn clip(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

fn ms(v: Option<f64>) -> Option<i64> {
    v.filter(|x| x.is_finite() && *x >= 0.0 && *x < 1.0e11).map(|x| x as i64)
}

fn https_or_empty(url: &str, max: usize) -> String {
    let u = url.trim();
    if u.len() <= max && u.starts_with("https://") && !u.contains(char::is_whitespace) {
        u.to_string()
    } else {
        String::new()
    }
}

pub fn validate_tab(r: TabReport, browser: &str, conn: u64, now_ms: i64) -> Option<BrowserTab> {
    let domain = r.domain.trim().trim_start_matches("www.").to_ascii_lowercase();
    let site = site_for(&domain)?;
    if r.tab_id < 0 || domain.len() > 120 {
        return None;
    }
    let url = https_or_empty(&r.url, 2048);
    // A URL tem de pertencer ao mesmo domínio informado — nada de abrir outro site.
    let url = match url.strip_prefix("https://").and_then(|rest| rest.split(['/', '?', '#']).next()) {
        Some(host) if site_for(host) == Some(site) => url,
        _ => String::new(),
    };
    Some(BrowserTab {
        key: format!("{browser}:{conn}:{}", r.tab_id),
        browser: browser.to_string(),
        tab_id: r.tab_id,
        domain,
        site: site.to_string(),
        title: clip(&r.title, 300),
        artist: clip(&r.artist, 200),
        album: clip(&r.album, 200),
        url,
        artwork_url: https_or_empty(&r.artwork_url, 2048),
        playing: r.playing,
        position_ms: ms(r.position_ms),
        duration_ms: ms(r.duration_ms),
        can_seek: r.can_seek,
        can_next: r.can_next,
        can_previous: r.can_previous,
        updated_at_ms: now_ms,
    })
}

pub fn sanitize_browser(name: &str) -> String {
    let n = name.to_ascii_lowercase();
    ["chrome", "edge", "brave", "firefox", "opera", "vivaldi", "chromium"]
        .into_iter()
        .find(|b| n.contains(b))
        .unwrap_or("browser")
        .to_string()
}

pub fn write_frame(w: &mut impl Write, json: &[u8]) -> std::io::Result<()> {
    let len = u32::try_from(json.len()).map_err(|_| std::io::Error::other("mensagem grande demais"))?;
    w.write_all(&len.to_le_bytes())?;
    w.write_all(json)?;
    w.flush()
}

/// Lê um quadro do Native Messaging. `Ok(None)` = fim do stdin (o navegador fechou a porta).
pub fn read_frame(r: &mut impl Read) -> std::io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(len) as usize;
    if n == 0 || n > MAX_FRAME {
        return Err(std::io::Error::other(format!("quadro de {n} bytes rejeitado")));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    Ok(Some(buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(domain: &str, url: &str) -> TabReport {
        TabReport {
            tab_id: 7,
            domain: domain.into(),
            title: "Lo-fi\u{0007} beats".into(),
            artist: "Canal".into(),
            album: String::new(),
            url: url.into(),
            artwork_url: "javascript:alert(1)".into(),
            playing: true,
            position_ms: Some(1234.6),
            duration_ms: Some(f64::NAN),
            can_seek: true,
            can_next: false,
            can_previous: false,
        }
    }

    #[test]
    fn frames_roundtrip_and_reject_oversized() {
        let mut buf = Vec::new();
        write_frame(&mut buf, br#"{"type":"pong","nonce":1}"#).unwrap();
        let mut cur = std::io::Cursor::new(buf);
        assert_eq!(read_frame(&mut cur).unwrap().unwrap(), br#"{"type":"pong","nonce":1}"#);
        assert!(read_frame(&mut cur).unwrap().is_none());
        let mut big = std::io::Cursor::new(((MAX_FRAME as u32) + 1).to_le_bytes().to_vec());
        assert!(read_frame(&mut big).is_err());
    }

    #[test]
    fn messages_are_closed_types() {
        let ok: ExtMessage = serde_json::from_str(r#"{"type":"gone","tabId":3}"#).unwrap();
        assert_eq!(ok, ExtMessage::Gone { tab_id: 3 });
        assert!(serde_json::from_str::<ExtMessage>(r#"{"type":"eval","code":"x"}"#).is_err());
        assert!(serde_json::from_str::<ExtMessage>(r#"{"type":"gone","tabId":3,"extra":1}"#).is_err());
    }

    #[test]
    fn tab_reports_are_sanitized() {
        let t = validate_tab(report("www.youtube.com", "https://www.youtube.com/watch?v=abc"), "chrome", 1, 99).unwrap();
        assert_eq!(t.site, "YouTube");
        assert_eq!(t.title, "Lo-fi beats");
        assert_eq!(t.artwork_url, "");
        assert_eq!(t.position_ms, Some(1234));
        assert_eq!(t.duration_ms, None);
        assert_eq!(t.key, "chrome:1:7");
        assert_eq!(validate_tab(report("music.youtube.com", ""), "edge", 1, 0).unwrap().site, "YouTube Music");
    }

    #[test]
    fn unsupported_domains_and_foreign_urls_are_dropped() {
        assert!(validate_tab(report("evil.example", "https://evil.example"), "chrome", 1, 0).is_none());
        assert!(validate_tab(report("notyoutube.com", ""), "chrome", 1, 0).is_none());
        let t = validate_tab(report("netflix.com", "https://evil.example/netflix.com"), "chrome", 1, 0).unwrap();
        assert_eq!(t.url, "", "a URL precisa ser do mesmo site informado");
        let t = validate_tab(report("netflix.com", "http://www.netflix.com/watch/1"), "chrome", 1, 0).unwrap();
        assert_eq!(t.url, "", "só https");
    }
}
