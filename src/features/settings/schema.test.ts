import { describe, expect, it } from "vitest";
import { acceleratorFromEvent } from "./sections";
import { defaultSettings, sanitizeSettings } from "./schema";

describe("preferências", () => {
  it("dados ausentes ou lixo viram os padrões", () => {
    expect(sanitizeSettings(undefined)).toEqual(defaultSettings());
    expect(sanitizeSettings("x")).toEqual(defaultSettings());
  });

  it("limita intervalos e rejeita valores fora da lista", () => {
    const s = sanitizeSettings({
      general: { language: "fr", hoverDelayMs: 99999, offsetY: -5, visibility: "sometimes" },
      appearance: { accent: 140, opacity: 10, size: "xl" },
      tools: { downloadMode: "4k", watchClipboard: "sim" },
      media: { blocked: ["discord", 3] },
      water: { goalMl: 10, activeFrom: "25:00", activeTo: "21:30" },
    });
    expect(s.general.language).toBe("pt-BR");
    expect(s.general.hoverDelayMs).toBe(1500);
    expect(s.general.offsetY).toBe(0);
    expect(s.general.visibility).toBe("hideFullscreen");
    expect(s.appearance.accent).toBe(100);
    expect(s.appearance.opacity).toBe(70);
    expect(s.appearance.size).toBe("m");
    expect(s.tools.downloadMode).toBe("video");
    expect(s.tools.watchClipboard).toBe(true);
    expect(s.media.blocked).toEqual(["discord"]);
    expect(s.water.goalMl).toBe(250);
    expect(s.water.activeFrom).toBe("08:00");
    expect(s.water.activeTo).toBe("21:30");
  });

  it("preserva preferências válidas de outra versão sem perder as novas", () => {
    const s = sanitizeSettings({ media: { policy: "manual" } });
    expect(s.media.policy).toBe("manual");
    expect(s.media.showArtwork).toBe(true);
  });
});

describe("gravador de atalho", () => {
  const ev = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });
  it("monta aceleradores válidos e exige modificador", () => {
    expect(acceleratorFromEvent(ev("Space", { altKey: true, shiftKey: true }))).toBe("Alt+Shift+Space");
    expect(acceleratorFromEvent(ev("KeyK", { ctrlKey: true }))).toBe("Ctrl+K");
    expect(acceleratorFromEvent(ev("F5", { metaKey: true }))).toBe("Super+F5");
    expect(acceleratorFromEvent(ev("KeyK"))).toBeNull();
    expect(acceleratorFromEvent(ev("ShiftLeft", { shiftKey: true }))).toBeNull();
  });

  it("v1 com o afastamento padrão antigo (6 px) vira notch; valor escolhido fica", () => {
    expect(sanitizeSettings({ version: 1, general: { offsetY: 6 } }).general.offsetY).toBe(0);
    expect(sanitizeSettings({ version: 1, general: { offsetY: 10 } }).general.offsetY).toBe(10);
    expect(sanitizeSettings({ version: 2, general: { offsetY: 6 } }).general.offsetY).toBe(6);
  });
});
