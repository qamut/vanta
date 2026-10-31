import { describe, expect, it } from "vitest";
import type { BrowserTab, MediaSession, MediaSnapshot } from "../../types";
import { livePosition, mergeTracks, pickActive, titlesMatch } from "./selection";

const controls = { play: true, pause: true, toggle: true, next: true, previous: true, seek: true, shuffle: false, repeat: false };

function session(id: string, over: Partial<MediaSession> = {}): MediaSession {
  return {
    id,
    appId: id.split("#")[0] ?? id,
    app: { name: "Spotify", kind: "app", brand: "spotify", resolvedBy: "table" },
    title: "Paper Sky",
    artist: "Lumen Coast",
    album: "Summer Flows",
    albumArtist: "",
    subtitle: "",
    trackNumber: 1,
    kind: "music",
    status: "playing",
    controls,
    timeline: { startMs: 0, endMs: 240_000, positionMs: 60_000, updatedAtMs: 1_000, minSeekMs: 0, maxSeekMs: 240_000 },
    rate: 1,
    shuffle: null,
    repeat: null,
    artworkKey: "abc",
    ...over,
  };
}

function tab(key: string, over: Partial<BrowserTab> = {}): BrowserTab {
  return {
    key,
    browser: "chrome",
    tabId: 1,
    domain: "youtube.com",
    site: "YouTube",
    title: "Lo-fi beats to study",
    artist: "Canal",
    album: "",
    url: "https://www.youtube.com/watch?v=x",
    artworkUrl: "",
    playing: true,
    positionMs: 5_000,
    durationMs: 100_000,
    canSeek: true,
    canNext: true,
    canPrevious: false,
    updatedAtMs: 2_000,
    ...over,
  };
}

const snap = (sessions: MediaSession[], systemCurrentId: string | null = null): MediaSnapshot => ({
  available: true,
  error: null,
  sessions,
  systemCurrentId,
  revision: 1,
});

const chrome = { name: "Google Chrome", kind: "browser" as const, brand: "chrome", resolvedBy: "shell" as const };

describe("mesclagem de sessões e abas", () => {
  it("compara títulos de forma tolerante", () => {
    expect(titlesMatch("Lo-fi beats to study - YouTube", "lo fi beats to study")).toBe(true);
    expect(titlesMatch("Música", "musica")).toBe(true);
    expect(titlesMatch("abc", "xyz abc")).toBe(false); // curto demais para "contém"
  });

  it("aba com o mesmo título enriquece a sessão do navegador", () => {
    const s = session("Chrome#0", { app: chrome, title: "Lo-fi beats to study", artist: "" });
    const tracks = mergeTracks(snap([s]), [tab("chrome:1:1")]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ siteName: "YouTube", artist: "Canal", url: "https://www.youtube.com/watch?v=x", source: "system" });
  });

  it("aba sem sessão correspondente vira faixa própria; sessão fechada some", () => {
    const tracks = mergeTracks(snap([session("Spotify.exe#0"), session("x#0", { status: "closed" })]), [tab("edge:2:9")]);
    expect(tracks.map((t) => t.id)).toEqual(["Spotify.exe#0", "tab:edge:2:9"]);
  });

  it("não depende da extensão: sem abas, só as sessões do Windows", () => {
    expect(mergeTracks(snap([session("Spotify.exe#0")]), [])).toHaveLength(1);
    expect(mergeTracks(null, [])).toEqual([]);
  });
});

describe("escolha da sessão ativa", () => {
  const base = { policy: "smart" as const, userChoice: null, previous: null, systemCurrentId: null, preferredApp: null };

  it("prefere quem está tocando e mantém a anterior em empate", () => {
    const tracks = mergeTracks(snap([session("A#0", { status: "paused" }), session("B#0"), session("C#0")]), []);
    expect(pickActive(tracks, base)?.id).toBe("B#0");
    expect(pickActive(tracks, { ...base, previous: "C#0" })?.id).toBe("C#0");
  });

  it("respeita a escolha do usuário e o app preferido", () => {
    const tracks = mergeTracks(
      snap([session("A#0", { status: "paused" }), session("Chrome#0", { app: chrome, title: "x video" }), session("Spotify.exe#0")]),
      [],
    );
    expect(pickActive(tracks, { ...base, preferredApp: "chrome" })?.id).toBe("Chrome#0");
    expect(pickActive(tracks, { ...base, policy: "manual", userChoice: "A#0" })?.id).toBe("A#0");
    expect(pickActive(tracks, { ...base, policy: "system", systemCurrentId: "A#0" })?.id).toBe("A#0");
  });

  it("sem nada tocando, volta à escolhida, à anterior ou à do Windows", () => {
    const tracks = mergeTracks(snap([session("A#0", { status: "paused" }), session("B#0", { status: "stopped" })]), []);
    expect(pickActive(tracks, { ...base, systemCurrentId: "B#0" })?.id).toBe("B#0");
    expect(pickActive(tracks, base)?.id).toBe("A#0");
    expect(pickActive([], base)).toBeNull();
  });
});

describe("posição interpolada", () => {
  it("avança só tocando, respeita a velocidade e limita à duração", () => {
    const t = { positionMs: 60_000, positionAt: 1_000, playing: true, rate: 1, durationMs: 240_000 };
    expect(livePosition(t, 11_000)).toBe(70_000);
    expect(livePosition({ ...t, rate: 2 }, 11_000)).toBe(80_000);
    expect(livePosition({ ...t, playing: false }, 99_000)).toBe(60_000);
    expect(livePosition(t, 10_000_000)).toBe(240_000);
    expect(livePosition({ ...t, positionMs: null }, 0)).toBeNull();
  });
});
