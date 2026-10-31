// Largura da coluna da letra. A preferência salva fica em settings.media.lyricsWidth; durante o
// arrasto da divisória a largura "ao vivo" mora aqui, para não gravar em disco a cada pixel.
import { create } from "zustand";
import { useSettings } from "../settings/store";

export const LYRICS_W = { min: 220, max: 600, default: 300 } as const;

export const clampLyricsW = (w: number) => Math.round(Math.min(LYRICS_W.max, Math.max(LYRICS_W.min, w)));

export const useLyricsLive = create<{ live: number | null }>(() => ({ live: null }));

/** Largura em uso agora: a do arrasto, se houver; senão a salva. */
export function useLyricsWidth(): number {
  const saved = useSettings((s) => s.value.media.lyricsWidth);
  const live = useLyricsLive((s) => s.live);
  return live ?? saved;
}
