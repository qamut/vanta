import { describe, expect, it } from "vitest";
import {
  ALL_MODULES,
  clampCustom,
  compactView,
  defaultModule,
  EXPANDED,
  hitRect,
  initialIsland,
  islandReducer,
  notchPath,
  LYRICS_EXTRA_W,
  PAUSED_LINGER_MS,
  sizeFor,
  unionRect,
  WINDOW_H,
  WINDOW_W,
  type CompactContext,
} from "./machine";

const ctx = (over: Partial<CompactContext> = {}): CompactContext => ({
  now: 1_000_000,
  media: { present: false, playing: false, pausedSince: null, peekUntil: null },
  jobRunning: false,
  alertUntil: null,
  lastActivityAt: 1_000_000,
  compactStyle: "eyes",
  idleAfterMin: 10,
  ...over,
});

describe("vista recolhida", () => {
  it("segue a prioridade alerta > espiar > trabalho > mídia > pausado > ocioso > repouso", () => {
    const media = { present: true, playing: true, pausedSince: null, peekUntil: null };
    expect(compactView(ctx())).toBe("resting");
    expect(compactView(ctx({ compactStyle: "summary" }))).toBe("summary");
    expect(compactView(ctx({ media }))).toBe("media");
    expect(compactView(ctx({ media, jobRunning: true }))).toBe("job");
    expect(compactView(ctx({ media: { ...media, peekUntil: 1_000_500 }, jobRunning: true }))).toBe("mediaPeek");
    expect(compactView(ctx({ media, alertUntil: 1_000_001 }))).toBe("alert");
  });

  it("mídia pausada fica um tempo e depois a ilha descansa", () => {
    const paused = { present: true, playing: false, pausedSince: 1_000_000 - 1000, peekUntil: null };
    expect(compactView(ctx({ media: paused }))).toBe("mediaPaused");
    expect(compactView(ctx({ media: { ...paused, pausedSince: 1_000_000 - PAUSED_LINGER_MS - 1 } }))).toBe("resting");
  });

  it("fica discreta após o tempo configurado, e nunca com 0", () => {
    expect(compactView(ctx({ lastActivityAt: 1_000_000 - 11 * 60_000 }))).toBe("idle");
    expect(compactView(ctx({ lastActivityAt: 0, idleAfterMin: 0 }))).toBe("resting");
  });
});

describe("navegação", () => {
  it("navega em anel e guarda a direção", () => {
    let s = islandReducer(initialIsland, { type: "expand", via: "click", module: "notifications" });
    s = islandReducer(s, { type: "next" });
    expect(s).toMatchObject({ module: "music", dir: 1 });
    s = islandReducer(s, { type: "prev" });
    expect(s).toMatchObject({ module: "notifications", dir: -1 });
    s = islandReducer(s, { type: "select", module: "convert" });
    expect(s).toMatchObject({ module: "convert", dir: -1 });
  });

  it("a letra abre e fecha no próprio player", () => {
    expect(initialIsland.lyrics).toBe(true);
    let s = islandReducer(initialIsland, { type: "lyrics" });
    expect(s.lyrics).toBe(false);
    s = islandReducer(s, { type: "lyrics" });
    expect(s.lyrics).toBe(true);
  });

  it("volta ao último módulo; alerta tem prioridade", () => {
    expect(defaultModule("water")).toBe("water");
    expect(defaultModule("tasks", "download")).toBe("download");
    expect(defaultModule("tasks", "power")).toBe("tasks");
  });

  it("configurações abrem dentro da ilha e recolher fecha tudo", () => {
    let s = islandReducer(initialIsland, { type: "settings", open: true });
    expect(s).toMatchObject({ settings: true, expanded: true });
    s = islandReducer(s, { type: "collapse" });
    expect(s).toMatchObject({ settings: false, expanded: false });
  });
});

describe("geometria", () => {
  const g = { windowW: WINDOW_W, windowH: WINDOW_H };

  it("tudo cabe na janela, inclusive com a letra aberta no tamanho grande", () => {
    for (const m of ALL_MODULES) {
      const e = sizeFor({ expanded: true, module: m, compact: "resting", lyrics: true }, 1.12, true, g);
      expect(e.w).toBeLessThanOrEqual(WINDOW_W);
      expect(e.h).toBeLessThanOrEqual(WINDOW_H);
    }
    const withLyrics = sizeFor({ expanded: true, module: "music", compact: "resting", lyrics: true }, 1, true, g);
    expect(withLyrics.w).toBe(EXPANDED.music.w + LYRICS_EXTRA_W);
  });

  it("tamanho personalizado é limitado entre o mínimo do módulo e a janela", () => {
    expect(clampCustom("music", { w: 10, h: 10 }, g, 1)).toEqual({ w: Math.round(EXPANDED.music.w * 0.82), h: EXPANDED.music.h });
    const big = clampCustom("music", { w: 5000, h: 5000 }, g, 1);
    expect(big.w).toBeLessThanOrEqual(WINDOW_W);
    expect(big.h).toBeLessThanOrEqual(WINDOW_H);
  });

  it("a área de hover é exatamente a ilha, encostada no topo", () => {
    const r = hitRect({ w: 200, h: 34, r: 15 }, 1200);
    expect(r).toEqual({ x: 500, y: 0, w: 200, h: 34 });
    expect(unionRect(r, hitRect({ w: 600, h: 200, r: 34 }, 1200)).w).toBe(600);
  });

  it("notch: uma forma só, mesma sequência de comandos em qualquer tamanho", () => {
    const shape = (p: string) => p.replace(/-?[\d.]+/g, "#");
    const aberto = notchPath(760, 260, 34, 28);
    const fechado = notchPath(196, 34, 15, 18);
    expect(shape(aberto)).toBe(shape(fechado));
    expect(aberto).toContain("L 816 0"); // corpo + 2 orelhas
    // barra ociosa de 10 px: a orelha encolhe para caber, sem cruzar o canto de baixo
    expect(notchPath(120, 10, 8, 18)).toContain("A 5 5 0 0 0 125 5");
  });
});
