import { describe, expect, it } from "vitest";
import { activeLine, parseLyrics } from "./lrc";

describe("letras", () => {
  it("lê LRC com metadados, offset, várias marcas por linha e frações", () => {
    const l = parseLyrics("[ti:Paper Sky]\r\n[offset:+250]\n[00:01.5]um\n[00:10.25][00:30.00]refrão\n[00:20]\n[01:02.123]fim");
    expect(l?.kind).toBe("synced");
    if (l?.kind !== "synced") return;
    expect(l.offsetMs).toBe(250);
    expect(l.lines).toEqual([
      { timeMs: 1500, text: "um" },
      { timeMs: 10250, text: "refrão" },
      { timeMs: 20000, text: "" },
      { timeMs: 30000, text: "refrão" },
      { timeMs: 62123, text: "fim" },
    ]);
  });

  it("texto sem tempo continua texto simples", () => {
    const l = parseLyrics("primeira linha\n\nsegunda linha\n");
    expect(l).toEqual({ kind: "plain", lines: ["primeira linha", "segunda linha"] });
    expect(parseLyrics("   \n ")).toBeNull();
  });

  it("encontra a linha ativa por busca binária", () => {
    const lines = [0, 1000, 5000, 9000].map((t, i) => ({ timeMs: t, text: String(i) }));
    expect(activeLine(lines, -10)).toBe(-1);
    expect(activeLine(lines, 999)).toBe(0);
    expect(activeLine(lines, 5000)).toBe(2);
    expect(activeLine(lines, 99999)).toBe(3);
    expect(activeLine(lines, 4800, 250)).toBe(2);
  });
});
