// Quais sessões de mídia o VANTA mostra. O Windows lista qualquer app que registrou controles
// de mídia (Discord, WhatsApp, jogos…); a ilha só quer música e vídeo de verdade.
import type { MediaSession } from "../../types";

/** Players de música/vídeo reconhecidos (marca vinda de `media/names.rs`). */
export const MEDIA_APPS = new Set([
  "spotify",
  "apple-music",
  "media-player",
  "vlc",
  "tidal",
  "deezer",
  "amazon-music",
  "foobar2000",
  "musicbee",
  "aimp",
  "itunes",
  "mpc",
  "potplayer",
  "youtube",
  "netflix",
  "prime-video",
]);

/** Apps que tocam som mas não são "o que está tocando". */
const NOISY = ["discord", "whatsapp", "teams", "slack", "zoom", "telegram", "skype", "steam", "epic", "riot", "battle.net"];

/** Serviços de MÚSICA no navegador (marca vinda da ponte/do título). Vídeo de navegador não entra. */
export const MUSIC_SITES = ["music.youtube", "youtube music", "spotify", "deezer", "soundcloud", "tidal", "apple music", "music.apple", "amazon music", "music.amazon", "bandcamp", "audiomack", "pandora", "napster", "qobuz"];

/** Brands que o app reconhece mas que são VÍDEO (YouTube, Netflix…): só aparecem se o usuário quiser. */
const VIDEO_BRANDS = new Set(["youtube", "netflix", "prime-video"]);

export interface SourceRules {
  /** Aceitar outros players desconhecidos que publiquem música/vídeo com título. */
  extraApps: boolean;
  /** Apps que o usuário bloqueou (marca ou nome em minúsculas). */
  blocked: string[];
  /** Mostrar também vídeos tocando no navegador (YouTube, Netflix, Twitch…). Padrão: não. */
  browserVideos?: boolean;
}

/** Uma aba do navegador tocando MÚSICA: serviço de música conhecido, ou faixa com álbum. */
export function looksLikeMusic(hint: string, album: string): boolean {
  const h = hint.toLowerCase();
  return MUSIC_SITES.some((m) => h.includes(m)) || !!album.trim();
}

const durationMs = (s: MediaSession) => (s.timeline ? s.timeline.endMs - s.timeline.startMs : 0);

export function sourceKey(s: MediaSession): string {
  return s.app.brand || s.app.name.toLowerCase();
}

export function isWanted(s: MediaSession, rules: SourceRules): boolean {
  const key = sourceKey(s);
  const name = `${s.app.name} ${s.appId}`.toLowerCase();
  if (rules.blocked.includes(key)) return false;
  if (NOISY.some((n) => name.includes(n))) return false;
  if (s.kind === "image") return false;
  if (!s.title.trim()) return false;
  if (VIDEO_BRANDS.has(s.app.brand)) return !!rules.browserVideos;
  if (MEDIA_APPS.has(s.app.brand)) return true;
  if (s.app.kind === "browser") {
    // Navegador: música sim (YouTube Music, Spotify Web…, ou faixa com álbum); vídeo — um YouTube
    // qualquer, com canal e duração — só se o usuário pedir.
    const media = !!(s.artist || s.albumArtist) || durationMs(s) >= 30_000;
    if (!media) return false;
    if (rules.browserVideos) return true;
    return s.kind === "music" && looksLikeMusic(`${s.title} ${s.subtitle} ${s.artist}`, s.album);
  }
  return rules.extraApps && (s.kind === "music" || s.kind === "video");
}
