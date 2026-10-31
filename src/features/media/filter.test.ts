import { describe, expect, it } from "vitest";
import type { MediaSession } from "../../types";
import { isWanted } from "./filter";

const controls = { play: true, pause: true, toggle: true, next: true, previous: true, seek: true, shuffle: false, repeat: false };
const s = (over: Partial<MediaSession> & { brand?: string; kindApp?: "app" | "browser" | "unknown"; name?: string }): MediaSession => ({
  id: "x#0",
  appId: over.appId ?? "x.exe",
  app: { name: over.name ?? "App", kind: over.kindApp ?? "app", brand: over.brand ?? "", resolvedBy: "shell" },
  title: "Faixa",
  artist: "",
  album: "",
  albumArtist: "",
  subtitle: "",
  trackNumber: 0,
  kind: "music",
  status: "playing",
  controls,
  timeline: null,
  rate: 1,
  shuffle: null,
  repeat: null,
  artworkKey: null,
  ...over,
});

const rules = { extraApps: false, blocked: [] as string[] };

describe("filtro de fontes", () => {
  it("aceita players conhecidos", () => {
    expect(isWanted(s({ brand: "spotify", name: "Spotify" }), rules)).toBe(true);
  });

  it("navegador: música entra, vídeo do YouTube não (a menos que o usuário peça)", () => {
    // YouTube Music / faixa com álbum
    expect(isWanted(s({ kindApp: "browser", brand: "chrome", artist: "Artista", album: "Disco" }), rules)).toBe(true);
    // um vídeo qualquer do YouTube: canal + duração, sem álbum
    const video = s({ kindApp: "browser", brand: "chrome", artist: "Canal", timeline: { startMs: 0, endMs: 600_000, positionMs: 0, updatedAtMs: 0, minSeekMs: 0, maxSeekMs: 0 } });
    expect(isWanted(video, rules)).toBe(false);
    expect(isWanted(video, { ...rules, browserVideos: true })).toBe(true);
    expect(isWanted(s({ brand: "youtube", kindApp: "browser" }), rules)).toBe(false);
    expect(isWanted(s({ brand: "netflix", kindApp: "browser" }), { ...rules, browserVideos: true })).toBe(true);
    expect(isWanted(s({ kindApp: "browser", brand: "chrome" }), rules)).toBe(false);
    expect(isWanted(s({ kindApp: "browser", brand: "chrome", title: "" , artist: "x"}), rules)).toBe(false);
  });

  it("ignora apps de conversa e jogos, e desconhecidos por padrão", () => {
    expect(isWanted(s({ name: "Discord", appId: "Discord.exe" }), { ...rules, extraApps: true })).toBe(false);
    expect(isWanted(s({ name: "WhatsApp" }), rules)).toBe(false);
    expect(isWanted(s({ name: "Algum Player" }), rules)).toBe(false);
    expect(isWanted(s({ name: "Algum Player" }), { ...rules, extraApps: true })).toBe(true);
  });

  it("respeita o bloqueio do usuário", () => {
    expect(isWanted(s({ brand: "spotify" }), { ...rules, blocked: ["spotify"] })).toBe(false);
  });
});
