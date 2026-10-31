// Estado de mídia na interface: snapshot do Windows, abas da extensão, capas e a escolha
// do usuário. A escolha manual é persistida para sobreviver a reinícios.
import { useMemo } from "react";
import { create } from "zustand";
import { errorCode, errorMessage, inTauri, ipc, on } from "../../lib/ipc";
import { tr } from "../../lib/i18n";
import { createPersisted, isObj } from "../../lib/persisted";
import type { BrowserTab, MediaAction, MediaSnapshot } from "../../types";
import { pushNotice } from "../notifications/store";
import { useSettings } from "../settings/store";
import { isWanted, looksLikeMusic } from "./filter";
import { mergeTracks, pickActive, type Track } from "./selection";

interface MediaLive {
  snapshot: MediaSnapshot | null;
  tabs: BrowserTab[];
  artwork: Record<string, string>;
  /** Cor média da capa (rgb "r, g, b"), para tingir o brilho e a linha do tempo. */
  tint: Record<string, string>;
  previousId: string | null;
  /** Desde quando cada sessão/aba está sem tocar (para a cápsula "soltar" a mídia pausada). */
  pausedAt: Record<string, number>;
  lastError: { message: string; at: number } | null;
  pending: MediaAction | null;
}

export const useMedia = create<MediaLive>(() => ({
  snapshot: null,
  tabs: [],
  artwork: {},
  tint: {},
  previousId: null,
  pausedAt: {},
  lastError: null,
  pending: null,
}));

interface MediaPrefs {
  userChoice: string | null;
}
export const useMediaPrefs = createPersisted<MediaPrefs>(
  "media-prefs",
  () => ({ userChoice: null }),
  (raw) => ({ userChoice: isObj(raw) && typeof raw.userChoice === "string" ? raw.userChoice.slice(0, 512) : null }),
);

export function useTracks(): Track[] {
  const snapshot = useMedia((s) => s.snapshot);
  const tabs = useMedia((s) => s.tabs);
  const bridge = useSettings((s) => s.value.media.useBrowserBridge);
  const extraApps = useSettings((s) => s.value.media.extraApps);
  const blocked = useSettings((s) => s.value.media.blocked);
  const browserVideos = useSettings((s) => s.value.media.browserVideos);
  return useMemo(() => {
    // Só música e vídeo de verdade: o Windows também lista Discord, jogos, chamadas…
    const rules = { extraApps, blocked, browserVideos };
    const filtered = snapshot ? { ...snapshot, sessions: snapshot.sessions.filter((s) => isWanted(s, rules)) } : snapshot;
    // abas da extensão: o mesmo critério (música sim, vídeo só se pedido)
    const okTabs = bridge ? tabs.filter((t) => browserVideos || looksLikeMusic(`${t.site} ${t.domain}`, t.album)) : [];
    return mergeTracks(filtered, okTabs);
  }, [snapshot, tabs, bridge, extraApps, blocked, browserVideos]);
}

export function useActiveTrack(): Track | null {
  const tracks = useTracks();
  const policy = useSettings((s) => s.value.media.policy);
  const preferredApp = useSettings((s) => s.value.media.preferredApp);
  const userChoice = useMediaPrefs((s) => s.value.userChoice);
  const previous = useMedia((s) => s.previousId);
  const systemCurrentId = useMedia((s) => s.snapshot?.systemCurrentId ?? null);
  return useMemo(
    () => pickActive(tracks, { policy, userChoice, previous, systemCurrentId, preferredApp }),
    [tracks, policy, userChoice, previous, systemCurrentId, preferredApp],
  );
}

export function rememberActive(id: string | null) {
  if (useMedia.getState().previousId !== id) useMedia.setState({ previousId: id });
}

export function chooseSession(id: string | null) {
  useMediaPrefs.getState().set({ userChoice: id });
  rememberActive(id);
}

/** Média de cor de uma imagem (amostra 12×12), clareada para funcionar sobre preto. */
async function averageColor(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 12;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 2 < d.length; i += 4) {
      const pr = d[i] ?? 0, pg = d[i + 1] ?? 0, pb = d[i + 2] ?? 0;
      // Pesa mais os pixels saturados: a cor "da capa", não o cinza do fundo.
      const w = 1 + ((Math.max(pr, pg, pb) - Math.min(pr, pg, pb)) / 255) * 4;
      r += pr * w; g += pg * w; b += pb * w; n += w;
    }
    const lift = (v: number) => Math.round(Math.min(255, 70 + (v / n) * 0.8));
    return `${lift(r)}, ${lift(g)}, ${lift(b)}`;
  } catch {
    return null;
  }
}

export async function ensureArtwork(key: string | null) {
  if (!key || !inTauri() || useMedia.getState().artwork[key]) return;
  const url = await ipc.mediaArtwork(key).catch(() => null);
  if (!url) return;
  useMedia.setState((s) => {
    // Mantém só as 12 mais recentes na memória da interface.
    const entries = [...Object.entries(s.artwork).filter(([k]) => k !== key), [key, url] as const].slice(-12);
    return { artwork: Object.fromEntries(entries) };
  });
  const tint = await averageColor(url);
  if (tint) useMedia.setState((s) => ({ tint: { ...s.tint, [key]: tint } }));
}

/** Envia um comando pela via que de fato suporta a ação (Windows primeiro, extensão depois). */
export async function sendCommand(track: Track, action: MediaAction, positionMs?: number) {
  const s = track.session;
  const c = s?.controls;
  const viaSystem =
    s &&
    c &&
    ((action === "toggle" && (c.toggle || c.play || c.pause)) ||
      (action === "play" && c.play) ||
      (action === "pause" && c.pause) ||
      (action === "next" && c.next) ||
      (action === "previous" && c.previous) ||
      (action === "seek" && c.seek));
  useMedia.setState({ pending: action });
  try {
    if (viaSystem && s) {
      const a = action === "toggle" && !c?.toggle ? (track.playing ? "pause" : "play") : action;
      await ipc.mediaCommand(s.id, a, positionMs);
    } else if (track.tab) {
      await ipc.bridgeCommand(track.tab.key, action, positionMs);
    } else {
      throw { code: "unsupported", message: tr("media.error.unsupported") };
    }
    useMedia.setState({ lastError: null });
  } catch (e) {
    const message = errorCode(e) === "session_gone" ? tr("media.error.gone") : errorMessage(e);
    useMedia.setState({ lastError: { message, at: Date.now() } });
  } finally {
    useMedia.setState({ pending: null });
  }
}

let wired = false;
export function wireMedia() {
  if (wired || !inTauri()) return;
  wired = true;
  let notifiedUnavailable = false;
  const trackPauses = (ids: { id: string; playing: boolean }[]) => {
    const prev = useMedia.getState().pausedAt;
    const now = Date.now();
    const next: Record<string, number> = {};
    for (const x of ids) if (!x.playing) next[x.id] = prev[x.id] ?? now;
    return next;
  };
  const apply = (snapshot: MediaSnapshot) => {
    const tabs = useMedia.getState().tabs.map((t) => ({ id: `tab:${t.key}`, playing: t.playing }));
    useMedia.setState({
      snapshot,
      pausedAt: trackPauses([...snapshot.sessions.map((s) => ({ id: s.id, playing: s.status === "playing" })), ...tabs]),
    });
    for (const s of snapshot.sessions) void ensureArtwork(s.artworkKey);
    if (!snapshot.available && !notifiedUnavailable) {
      notifiedUnavailable = true;
      pushNotice({ category: "integration", title: tr("media.unavailable.title"), body: snapshot.error ?? tr("media.unavailable.body") }, { native: true, module: "music" });
    }
    if (snapshot.available) notifiedUnavailable = false;
  };
  void ipc.mediaSnapshot().then(apply);
  void ipc.bridgeTabs().then((tabs) => useMedia.setState({ tabs }));
  void on("media://snapshot", apply);
  void on("bridge://tabs", (tabs) => {
    const sessions = (useMedia.getState().snapshot?.sessions ?? []).map((s) => ({ id: s.id, playing: s.status === "playing" }));
    useMedia.setState({ tabs, pausedAt: trackPauses([...sessions, ...tabs.map((t) => ({ id: `tab:${t.key}`, playing: t.playing }))]) });
  });
}
