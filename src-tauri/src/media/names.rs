//! Identificação do aplicativo de origem de uma sessão de mídia.
//!
//! O Windows só entrega o AppUserModelID (AUMID). A ordem de resolução é:
//! 1. o nome de exibição que o próprio Shell associa ao AUMID (`shell:AppsFolder\<AUMID>`) —
//!    o mesmo nome do menu Iniciar; funciona para Firefox, Chrome e apps da Store;
//! 2. uma tabela de executáveis conhecidos para AUMIDs do tipo `Spotify.exe`;
//! 3. um nome derivado do próprio AUMID, sem inventar marca.
//!
//! Se nada servir, o rótulo é neutro.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Browser,
    App,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub name: String,
    pub kind: SourceKind,
    /// Chave estável para ícone/cor no frontend (ex.: "spotify", "chrome"). Vazia se desconhecida.
    pub brand: String,
    /// Como o nome foi obtido: "shell" | "table" | "derived" | "neutral".
    pub resolved_by: &'static str,
}

const BROWSERS: &[(&str, &str)] = &[
    ("msedge", "edge"),
    ("microsoftedge", "edge"),
    ("chrome", "chrome"),
    ("firefox", "firefox"),
    ("brave", "brave"),
    ("opera", "opera"),
    ("vivaldi", "vivaldi"),
    ("thebrowsercompany.arc", "arc"),
    ("zen", "zen"),
    ("librewolf", "librewolf"),
    ("waterfox", "waterfox"),
];

const KNOWN_EXE: &[(&str, &str, &str)] = &[
    ("spotify.exe", "Spotify", "spotify"),
    ("chrome.exe", "Google Chrome", "chrome"),
    ("msedge.exe", "Microsoft Edge", "edge"),
    ("firefox.exe", "Firefox", "firefox"),
    ("brave.exe", "Brave", "brave"),
    ("opera.exe", "Opera", "opera"),
    ("vivaldi.exe", "Vivaldi", "vivaldi"),
    ("vlc.exe", "VLC", "vlc"),
    ("foobar2000.exe", "foobar2000", "foobar2000"),
    ("musicbee.exe", "MusicBee", "musicbee"),
    ("aimp.exe", "AIMP", "aimp"),
    ("itunes.exe", "iTunes", "itunes"),
    ("tidal.exe", "TIDAL", "tidal"),
    ("deezer.exe", "Deezer", "deezer"),
    ("mpc-hc64.exe", "MPC-HC", "mpc"),
    ("mpc-be64.exe", "MPC-BE", "mpc"),
    ("potplayermini64.exe", "PotPlayer", "potplayer"),
    ("discord.exe", "Discord", "discord"),
];

/// Marcas reconhecíveis a partir do nome de exibição/AUMID (para ícone e cor).
const BRANDS: &[(&str, &str)] = &[
    ("spotify", "spotify"),
    ("zunemusic", "media-player"),
    ("media player", "media-player"),
    ("applemusic", "apple-music"),
    ("apple music", "apple-music"),
    ("vlc", "vlc"),
    ("tidal", "tidal"),
    ("deezer", "deezer"),
    ("amazon music", "amazon-music"),
    ("netflix", "netflix"),
    ("primevideo", "prime-video"),
    ("prime video", "prime-video"),
    ("youtube", "youtube"),
    ("discord", "discord"),
];

pub fn classify(aumid: &str, display: &str) -> (SourceKind, String) {
    let a = aumid.to_ascii_lowercase();
    let d = display.to_ascii_lowercase();
    for (needle, brand) in BROWSERS {
        if a.contains(needle) || d.contains(needle) || (*brand == "edge" && d.contains("microsoft edge")) {
            return (SourceKind::Browser, (*brand).to_string());
        }
    }
    for (needle, brand) in BRANDS {
        if a.contains(needle) || d.contains(needle) {
            return (SourceKind::App, (*brand).to_string());
        }
    }
    (if display.is_empty() { SourceKind::Unknown } else { SourceKind::App }, String::new())
}

/// Nome a partir do AUMID quando o Shell não conhece a aplicação.
pub fn derive_name(aumid: &str) -> Option<(String, &'static str)> {
    let lower = aumid.to_ascii_lowercase();
    if let Some((_, name, _)) = KNOWN_EXE.iter().find(|(exe, _, _)| lower == *exe || lower.ends_with(&format!("\\{exe}"))) {
        return Some(((*name).to_string(), "table"));
    }
    // Caminho ou executável genérico: "C:\\...\\MyPlayer.exe" ou "MyPlayer.exe" -> "MyPlayer".
    let file = aumid.rsplit(['\\', '/']).next().unwrap_or(aumid);
    if let Some(stem) = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")) {
        if !stem.is_empty() {
            return Some((stem.to_string(), "derived"));
        }
    }
    // App empacotado: "Publisher.Name_hash!App" -> "Name".
    if let Some((family, _app)) = aumid.split_once('!') {
        let pkg = family.split('_').next().unwrap_or(family);
        let short = pkg.rsplit('.').next().unwrap_or(pkg);
        if !short.is_empty() && short.chars().any(|c| c.is_alphabetic()) {
            return Some((split_camel(short), "derived"));
        }
    }
    None
}

fn split_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    let mut prev_lower = false;
    for c in s.chars() {
        if c.is_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_lowercase();
        out.push(c);
    }
    out
}

pub fn identify(aumid: &str, shell_name: Option<String>) -> AppIdentity {
    let (name, resolved_by) = match shell_name.filter(|n| !n.trim().is_empty()) {
        Some(n) => (n, "shell"),
        None => match derive_name(aumid) {
            Some((n, how)) => (n, how),
            None => (String::new(), "neutral"),
        },
    };
    let (kind, brand) = classify(aumid, &name);
    AppIdentity {
        name: if name.is_empty() { "Fonte de mídia".to_string() } else { name },
        kind,
        brand,
        resolved_by,
    }
}

#[cfg(windows)]
pub fn shell_display_name(aumid: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromParsingName, SIGDN_NORMALDISPLAY};

    if aumid.is_empty() || aumid.len() > 400 {
        return None;
    }
    let path = HSTRING::from(format!("shell:AppsFolder\\{aumid}"));
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(&path, None).ok()?;
        let pw = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
        let name = pw.to_string().ok();
        CoTaskMemFree(Some(pw.0 as *const _));
        // Quando o Shell não conhece o AUMID ele devolve o próprio AUMID como nome.
        name.filter(|n| !n.eq_ignore_ascii_case(aumid) && !n.is_empty())
    }
}

#[cfg(not(windows))]
pub fn shell_display_name(_aumid: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_executables_use_the_table() {
        let id = identify("Spotify.exe", None);
        assert_eq!(id.name, "Spotify");
        assert_eq!(id.brand, "spotify");
        assert_eq!(id.kind, SourceKind::App);
        assert_eq!(id.resolved_by, "table");
    }

    #[test]
    fn browsers_are_classified_from_aumid_or_display_name() {
        assert_eq!(identify("MSEdge", Some("Microsoft Edge".into())).kind, SourceKind::Browser);
        assert_eq!(identify("Chrome", Some("Google Chrome".into())).brand, "chrome");
        // Firefox usa um hash do diretório como AUMID; o nome vem do Shell.
        let ff = identify("308046B0AF4A39CB", Some("Firefox".into()));
        assert_eq!((ff.kind, ff.brand.as_str(), ff.resolved_by), (SourceKind::Browser, "firefox", "shell"));
    }

    #[test]
    fn packaged_apps_and_generic_exes_are_derived_without_inventing_brands() {
        let id = identify("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", None);
        assert_eq!(id.name, "Zune Music");
        assert_eq!(id.resolved_by, "derived");
        let generic = identify("C:\\Tools\\CoolPlayer.exe", None);
        assert_eq!(generic.name, "CoolPlayer");
        assert_eq!(generic.brand, "");
    }

    #[test]
    fn unknown_sources_get_a_neutral_label() {
        let id = identify("1234567890ABCDEF", None);
        assert_eq!(id.name, "Fonte de mídia");
        assert_eq!(id.kind, SourceKind::Unknown);
        assert_eq!(id.resolved_by, "neutral");
    }
}
