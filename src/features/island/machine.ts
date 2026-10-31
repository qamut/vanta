// Máquina de estados da ilha. Pura: recebe o contexto e devolve a "vista" atual e as
// dimensões-alvo. A ilha anima entre dimensões; nunca troca de componente "no seco".

export const ALL_MODULES = ["music", "convert", "download", "tasks", "water", "notifications"] as const;
export type Module = (typeof ALL_MODULES)[number];

export type CompactView = "idle" | "resting" | "summary" | "media" | "mediaPaused" | "mediaPeek" | "job" | "alert";

export interface CompactContext {
  now: number;
  media: { present: boolean; playing: boolean; pausedSince: number | null; peekUntil: number | null };
  /** Há conversão ou download em andamento. */
  jobRunning: boolean;
  alertUntil: number | null;
  lastActivityAt: number;
  compactStyle: "eyes" | "summary";
  idleAfterMin: number;
}

/** Quanto tempo uma mídia pausada continua ocupando a ilha recolhida. */
export const PAUSED_LINGER_MS = 2 * 60_000;

export function compactView(c: CompactContext): CompactView {
  if (c.alertUntil !== null && c.alertUntil > c.now) return "alert";
  if (c.media.present && c.media.peekUntil !== null && c.media.peekUntil > c.now) return "mediaPeek";
  if (c.jobRunning) return "job";
  if (c.media.present && c.media.playing) return "media";
  if (c.media.present && c.media.pausedSince !== null && c.now - c.media.pausedSince < PAUSED_LINGER_MS) return "mediaPaused";
  if (c.idleAfterMin > 0 && c.now - c.lastActivityAt > c.idleAfterMin * 60_000) return "idle";
  return c.compactStyle === "summary" ? "summary" : "resting";
}

export interface IslandState {
  expanded: boolean;
  /** Configurações abertas dentro da própria ilha. */
  settings: boolean;
  module: Module;
  /** Letra aberta ao lado do player (a ilha se alarga). */
  lyrics: boolean;
  via: "hover" | "click" | "keyboard" | "alert" | null;
  /** Direção da última navegação, para a transição deslizar para o lado certo. */
  dir: 1 | -1;
}

export type IslandEvent =
  | { type: "expand"; via: IslandState["via"]; module?: Module }
  | { type: "collapse" }
  | { type: "select"; module: Module }
  | { type: "next" }
  | { type: "prev" }
  | { type: "lyrics"; open?: boolean }
  | { type: "settings"; open: boolean };

// A letra começa ligada: aparece sozinha ao lado do player quando a faixa tem letra.
export const initialIsland: IslandState = { expanded: false, settings: false, module: "music", lyrics: true, via: null, dir: 1 };

export function islandReducer(s: IslandState, e: IslandEvent): IslandState {
  switch (e.type) {
    case "expand":
      return { ...s, expanded: true, module: e.module ?? s.module, via: e.via };
    case "collapse":
      return s.expanded || s.settings ? { ...s, expanded: false, settings: false, via: null } : s;
    case "select": {
      const a = ALL_MODULES.indexOf(s.module);
      const b = ALL_MODULES.indexOf(e.module);
      return { ...s, module: e.module, expanded: true, settings: false, via: s.via ?? "click", dir: b >= a ? 1 : -1 };
    }
    case "next":
    case "prev": {
      const i = ALL_MODULES.indexOf(s.module);
      const step = e.type === "next" ? 1 : -1;
      const module = ALL_MODULES[(i + step + ALL_MODULES.length) % ALL_MODULES.length] ?? "music";
      return { ...s, module, dir: step };
    }
    case "lyrics":
      return { ...s, lyrics: e.open ?? !s.lyrics };
    case "settings":
      return e.open ? { ...s, settings: true, expanded: true, via: "click" } : { ...s, settings: false };
  }
}

/**
 * Módulo ao expandir: um alerta leva ao módulo dele; senão volta exatamente onde o usuário
 * estava (não "reseta" para a primeira opção).
 */
export function defaultModule(last: Module, alertModule?: string | null): Module {
  if (alertModule && (ALL_MODULES as readonly string[]).includes(alertModule)) return alertModule as Module;
  return last;
}

export interface Size {
  w: number;
  h: number;
  /** Raio dos cantos de baixo (os de cima são retos, colados no topo da tela). */
  r: number;
}

const COMPACT: Record<CompactView, Size> = {
  idle: { w: 120, h: 10, r: 8 },
  resting: { w: 196, h: 34, r: 15 },
  summary: { w: 252, h: 34, r: 15 },
  media: { w: 318, h: 34, r: 15 },
  mediaPaused: { w: 318, h: 34, r: 15 },
  mediaPeek: { w: 404, h: 58, r: 24 },
  job: { w: 300, h: 34, r: 15 },
  alert: { w: 420, h: 62, r: 26 },
};

/** Tamanhos-base dos módulos (px lógicos). O usuário pode redimensionar; ver `clampCustom`. */
export const EXPANDED: Record<Module, { w: number; h: number }> = {
  music: { w: 620, h: 210 },
  convert: { w: 660, h: 430 },
  download: { w: 620, h: 270 },
  tasks: { w: 660, h: 340 },
  water: { w: 600, h: 300 },
  notifications: { w: 580, h: 290 },
};
/** Largura extra quando a letra abre ao lado do player (coluna padrão de 300 + respiro). */
export const LYRICS_EXTRA_W = 320;
const LYRICS_GAP = 20;

export const SETTINGS_SIZE = { w: 1000, h: 640 };
export const EXPANDED_RADIUS = 34;

export interface Geometry {
  windowW: number;
  windowH: number;
}

/** Margem lateral que a ilha nunca invade dentro da janela (orelhas + sombra). */
export const EDGE = 44;

export function clampCustom(module: Module, size: { w: number; h: number }, g: Geometry, scale: number) {
  const base = EXPANDED[module];
  return {
    w: Math.round(Math.min(g.windowW - EDGE * 2, Math.max(base.w * 0.82 * scale, size.w))),
    h: Math.round(Math.min(g.windowH - EDGE, Math.max(base.h * scale, size.h))),
  };
}

export function sizeFor(
  view: { expanded: boolean; settings?: boolean; module: Module; compact: CompactView; lyrics?: boolean; lyricsW?: number },
  scale: number,
  comfortable: boolean,
  g: Geometry = { windowW: WINDOW_W, windowH: WINDOW_H },
  custom?: { w: number; h: number } | null,
): Size {
  if (view.settings) {
    return { w: Math.min(g.windowW - EDGE * 2, SETTINGS_SIZE.w), h: Math.min(g.windowH - EDGE, SETTINGS_SIZE.h), r: Math.round(30 * Math.min(1, scale)) };
  }
  if (view.expanded) {
    const e = EXPANDED[view.module];
    const pad = comfortable ? 0 : -14;
    // a ilha cresce junto com a coluna da letra: o player nunca é espremido
    const extra = view.module === "music" && view.lyrics ? (view.lyricsW !== undefined ? view.lyricsW + LYRICS_GAP : LYRICS_EXTRA_W) : 0;
    const base = { w: Math.round((e.w + extra) * scale), h: Math.round((e.h + pad + (extra ? 40 : 0)) * scale) };
    const s = custom ? clampCustom(view.module, { ...custom, w: custom.w + extra * scale }, g, scale) : base;
    return { w: Math.min(s.w, g.windowW - EDGE * 2), h: Math.min(s.h, g.windowH - EDGE), r: Math.round(EXPANDED_RADIUS * scale) };
  }
  const c = COMPACT[view.compact];
  return { w: Math.round(c.w * scale), h: Math.round(c.h * scale), r: Math.round(c.r * scale) };
}

/** Janela lógica padrão (ver src-tauri/src/island.rs; em telas pequenas ela é menor). */
export const WINDOW_W = 1200;
export const WINDOW_H = 780;
/** A ilha encosta no topo da tela: sem folga. */
export const TOP_GAP = 0;
/** Raio das "orelhas" côncavas que ligam a ilha à borda de cima da tela. */
export const EAR = 18;
/** Orelhas da ilha aberta: maiores, na proporção do raio de baixo. */
export const EAR_OPEN = 28;

export function earFor(size: Size): number {
  return size.h > 80 ? EAR_OPEN : EAR;
}

const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Contorno do notch como UMA forma só: topo reto da largura toda, orelhas côncavas nas pontas e
 * cantos de baixo arredondados. `w` é a largura do corpo; a forma tem `w + 2e`. Mesma sequência
 * de comandos em qualquer tamanho, para a mola interpolar o caminho.
 */
export function notchPath(w: number, h: number, r: number, ear: number): string {
  const R = Math.max(0, Math.min(r, h / 2, w / 2));
  const e = Math.max(0, Math.min(ear, h - R));
  const W = w + 2 * e;
  const p = [
    `M 0 0`,
    `L ${n2(W)} 0`,
    `A ${n2(e)} ${n2(e)} 0 0 0 ${n2(W - e)} ${n2(e)}`,
    `L ${n2(W - e)} ${n2(h - R)}`,
    `A ${n2(R)} ${n2(R)} 0 0 1 ${n2(W - e - R)} ${n2(h)}`,
    `L ${n2(e + R)} ${n2(h)}`,
    `A ${n2(R)} ${n2(R)} 0 0 1 ${n2(e)} ${n2(h - R)}`,
    `L ${n2(e)} ${n2(e)}`,
    `A ${n2(e)} ${n2(e)} 0 0 0 0 0`,
    `Z`,
  ];
  return `path("${p.join(" ")}")`;
}

/**
 * Retângulo interativo em px lógicos da janela: exatamente a ilha, sem folga. O hover só
 * acontece quando o ponteiro está DE FATO sobre ela.
 */
export function hitRect(size: Size, windowW: number = WINDOW_W, offsetX = 0) {
  return { x: Math.max(0, (windowW - size.w) / 2 + offsetX), y: TOP_GAP, w: Math.min(windowW, size.w), h: size.h };
}

export function unionRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
