// Leitura de letras: LRC sincronizado ([mm:ss.xx]) ou texto simples.
// Texto sem marcas de tempo é exibido como texto — nunca "fingimos" sincronização.

export interface LyricLine {
  timeMs: number;
  text: string;
}

export type Lyrics =
  | { kind: "synced"; lines: LyricLine[]; offsetMs: number }
  | { kind: "plain"; lines: string[] };

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[(ar|ti|al|by|re|ve|length|offset|au|#):?([^\]]*)\]$/i;

export function parseLyrics(text: string): Lyrics | null {
  const raw = text.replace(/\r\n?/g, "\n");
  if (!raw.trim()) return null;
  let offsetMs = 0;
  const synced: LyricLine[] = [];
  const plain: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const meta = META.exec(trimmed);
    if (meta) {
      if (meta[1]?.toLowerCase() === "offset") {
        const v = Number(meta[2]);
        if (Number.isFinite(v)) offsetMs = v;
      }
      continue;
    }
    const times: number[] = [];
    TIME.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = TIME.exec(trimmed)) && m.index === lastEnd) {
      const frac = m[3] ?? "0";
      const fracMs = Number(frac.padEnd(3, "0").slice(0, 3));
      times.push(Number(m[1]) * 60_000 + Number(m[2]) * 1000 + fracMs);
      lastEnd = TIME.lastIndex;
    }
    const content = trimmed.slice(lastEnd).trim();
    if (times.length > 0) {
      // Linha instrumental vazia continua valendo como "pausa" na sincronização.
      for (const t of times) synced.push({ timeMs: t, text: content });
    } else if (trimmed) {
      plain.push(trimmed);
    }
  }
  if (synced.length >= 2) {
    synced.sort((a, b) => a.timeMs - b.timeMs);
    return { kind: "synced", lines: synced, offsetMs };
  }
  const lines = plain.length ? plain : synced.map((s) => s.text).filter(Boolean);
  return lines.length ? { kind: "plain", lines } : null;
}

/** Índice da linha ativa para a posição atual (-1 antes da primeira). Busca binária. */
export function activeLine(lines: LyricLine[], positionMs: number, offsetMs = 0): number {
  const t = positionMs + offsetMs;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]?.timeMs ?? Infinity) <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
