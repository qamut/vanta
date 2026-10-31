// Letras da faixa ativa: pré-carregadas quando a faixa muda, para o botão de microfone já
// saber se há letra (sem letra = botão desativado). A busca é feita pelo Rust (LRCLIB).
import { useEffect } from "react";
import { create } from "zustand";
import { errorMessage, inTauri, ipc } from "../../lib/ipc";
import { useSettings } from "../settings/store";
import type { Track } from "../media/selection";
import { parseLyrics, type Lyrics } from "./lrc";

export type LyricsEntry =
  | { state: "loading" }
  | { state: "ready"; lyrics: Lyrics; source: string }
  | { state: "instrumental" }
  | { state: "none" }
  | { state: "off" }
  | { state: "error"; message: string };

interface LyricsStore {
  byKey: Record<string, LyricsEntry>;
}

export const useLyricsStore = create<LyricsStore>(() => ({ byKey: {} }));

export const lyricsKey = (t: Pick<Track, "artist" | "title" | "album" | "durationMs"> | null) =>
  t && t.title ? [t.artist, t.title, t.album, Math.round((t.durationMs ?? 0) / 1000)].join("\u0000") : "";

const inflight = new Set<string>();

async function load(track: Track, key: string) {
  if (inflight.has(key)) return;
  inflight.add(key);
  const set = (entry: LyricsEntry) =>
    useLyricsStore.setState((s) => {
      const keys = Object.keys(s.byKey);
      const next = Object.fromEntries([...keys.slice(-60).map((k) => [k, s.byKey[k] as LyricsEntry]), [key, entry]]);
      return { byKey: next };
    });
  set({ state: "loading" });
  try {
    const r = await ipc.lyricsLookup(track.artist, track.title, track.album, track.durationMs);
    if (r.status === "instrumental") set({ state: "instrumental" });
    else if (r.status === "synced" || r.status === "plain") {
      const parsed = parseLyrics(r.text);
      set(parsed ? { state: "ready", lyrics: parsed, source: r.source } : { state: "none" });
    } else set({ state: "none" });
  } catch (e) {
    set({ state: "error", message: errorMessage(e) });
  } finally {
    inflight.delete(key);
  }
}

/** Liga a pré-carga à faixa ativa. Espera 700 ms para não consultar em pulos rápidos de faixa. */
export function useLyricsPrefetch(track: Track | null) {
  const enabled = useSettings((s) => s.value.media.onlineLyrics);
  const key = lyricsKey(track);
  useEffect(() => {
    if (!track || !key || !inTauri()) return;
    if (!enabled) {
      useLyricsStore.setState((s) => ({ byKey: { ...s.byKey, [key]: { state: "off" } } }));
      return;
    }
    const cur = useLyricsStore.getState().byKey[key];
    if (cur && cur.state !== "error" && cur.state !== "off") return;
    const id = setTimeout(() => void load(track, key), 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

// Referências estáveis: o seletor do zustand não pode devolver um objeto novo a cada leitura.
const LOADING: LyricsEntry = { state: "loading" };
const NONE: LyricsEntry = { state: "none" };

export function useLyricsFor(track: Track | null): LyricsEntry {
  const key = lyricsKey(track);
  return useLyricsStore((s) => (key ? (s.byKey[key] ?? LOADING) : NONE));
}

export const hasLyrics = (e: LyricsEntry) => e.state === "ready";
