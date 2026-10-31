// Escolha da sessão ativa, mesclagem com as abas da extensão e posição interpolada.
// Tudo puro: a interface só chama estas funções.
import type { BrowserTab, MediaSession, MediaSnapshot, PlaybackStatus } from "../../types";

export type SelectionPolicy = "smart" | "system" | "manual";

/** Uma sessão pronta para a interface: a do Windows, enriquecida pela aba quando houver. */
export interface Track {
  id: string;
  source: "system" | "browser";
  session: MediaSession | null;
  tab: BrowserTab | null;
  title: string;
  artist: string;
  album: string;
  appName: string;
  brand: string;
  siteName: string | null;
  url: string | null;
  status: PlaybackStatus;
  playing: boolean;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  durationMs: number | null;
  /** Posição conhecida e o instante em que ela era verdade. */
  positionMs: number | null;
  positionAt: number;
  rate: number;
  artworkKey: string | null;
  artworkUrl: string | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Títulos "batem" se um contém o outro depois de normalizados (o YouTube corta, o Chrome não). */
export function titlesMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y));
}

export function fromSession(s: MediaSession, tab: BrowserTab | null): Track {
  const tl = s.timeline;
  const duration = tl ? tl.endMs - tl.startMs : null;
  const playing = s.status === "playing";
  return {
    id: s.id,
    source: "system",
    session: s,
    tab,
    title: s.title || tab?.title || "",
    artist: s.artist || s.albumArtist || tab?.artist || "",
    album: s.album,
    appName: s.app.name,
    brand: s.app.brand,
    siteName: tab?.site ?? null,
    url: tab?.url || null,
    status: s.status,
    playing,
    canPlayPause: s.controls.toggle || (playing ? s.controls.pause : s.controls.play),
    canNext: s.controls.next || !!tab?.canNext,
    canPrevious: s.controls.previous || !!tab?.canPrevious,
    canSeek: (s.controls.seek && !!duration && duration > 0) || !!tab?.canSeek,
    durationMs: duration && duration > 0 ? duration : (tab?.durationMs ?? null),
    positionMs: tl && duration && duration > 0 ? tl.positionMs - tl.startMs : (tab?.positionMs ?? null),
    positionAt: tl && duration && duration > 0 ? tl.updatedAtMs : (tab?.updatedAtMs ?? Date.now()),
    rate: s.rate && s.rate > 0 ? s.rate : 1,
    artworkKey: s.artworkKey,
    artworkUrl: null,
  };
}

export function fromTab(t: BrowserTab): Track {
  return {
    id: `tab:${t.key}`,
    source: "browser",
    session: null,
    tab: t,
    title: t.title,
    artist: t.artist,
    album: t.album,
    appName: t.browser,
    brand: t.browser,
    siteName: t.site,
    url: t.url || null,
    status: t.playing ? "playing" : "paused",
    playing: t.playing,
    canPlayPause: true,
    canNext: t.canNext,
    canPrevious: t.canPrevious,
    canSeek: t.canSeek,
    durationMs: t.durationMs,
    positionMs: t.positionMs,
    positionAt: t.updatedAtMs,
    rate: 1,
    artworkKey: null,
    artworkUrl: t.artworkUrl || null,
  };
}

/**
 * Junta sessões do Windows e abas da extensão. Uma aba que corresponde a uma sessão de
 * navegador (mesmo título) só enriquece aquela sessão; abas sem par viram faixas próprias
 * (por exemplo, quando o site não publica sessão para o Windows).
 */
export function mergeTracks(snapshot: MediaSnapshot | null, tabs: BrowserTab[]): Track[] {
  const sessions = (snapshot?.sessions ?? []).filter((s) => s.status !== "closed");
  const used = new Set<string>();
  const tracks = sessions.map((s) => {
    const tab =
      s.app.kind === "browser"
        ? tabs.find((t) => !used.has(t.key) && titlesMatch(t.title, s.title)) ??
          (tabs.filter((t) => !used.has(t.key)).length === 1 && sessions.filter((x) => x.app.kind === "browser").length === 1
            ? tabs.find((t) => !used.has(t.key)) ?? null
            : null)
        : null;
    if (tab) used.add(tab.key);
    return fromSession(s, tab);
  });
  for (const t of tabs) if (!used.has(t.key)) tracks.push(fromTab(t));
  return tracks;
}

const statusRank = (t: Track) => (t.playing ? 0 : t.status === "paused" ? 1 : 2);

/**
 * Política de escolha:
 * - manual: a escolhida pelo usuário enquanto existir;
 * - system: a que o Windows considera atual;
 * - smart (padrão): mantém a atual se ainda toca; senão a que está tocando (preferindo o app
 *   preferido), depois a escolhida pelo usuário, depois a do Windows.
 * Nunca troca "aleatoriamente": empates mantêm a sessão anterior.
 */
export function pickActive(
  tracks: Track[],
  opts: { policy: SelectionPolicy; userChoice: string | null; previous: string | null; systemCurrentId: string | null; preferredApp: string | null },
): Track | null {
  if (tracks.length === 0) return null;
  const byId = (id: string | null) => (id ? tracks.find((t) => t.id === id) ?? null : null);
  const user = byId(opts.userChoice);
  const prev = byId(opts.previous);
  const system = byId(opts.systemCurrentId);

  if (opts.policy === "manual" && user) return user;
  if (opts.policy === "system" && system) return system;

  if (user && user.playing) return user;
  if (prev && prev.playing) return prev;
  const playing = tracks.filter((t) => t.playing);
  if (playing.length) {
    const pref = opts.preferredApp?.toLowerCase();
    const preferred = pref ? playing.find((t) => t.brand === pref || t.appName.toLowerCase() === pref) : undefined;
    if (preferred) return preferred;
    if (system?.playing) return system;
    return playing[0] ?? null;
  }
  return user ?? prev ?? system ?? [...tracks].sort((a, b) => statusRank(a) - statusRank(b))[0] ?? null;
}

/** Posição interpolada a partir do último valor conhecido (sem polling). */
export function livePosition(t: Pick<Track, "positionMs" | "positionAt" | "playing" | "rate" | "durationMs">, now: number): number | null {
  if (t.positionMs === null) return null;
  const p = t.playing ? t.positionMs + Math.max(0, now - t.positionAt) * t.rate : t.positionMs;
  const max = t.durationMs ?? Infinity;
  return Math.max(0, Math.min(max, p));
}

/** Chave de troca de faixa (para animações e "espiar" a nova faixa). */
export const trackKey = (t: Track | null) => (t ? `${t.id}|${t.title}|${t.artist}` : "");
