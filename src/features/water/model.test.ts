import { describe, expect, it } from "vitest";
import { addEntry, dailyTotals, hourly, initialWater, nextReminder, refill, segmentsFor, setBottle, setLevel, totalOn, undoLast } from "./model";

const at = (h: number, m = 0, day = 25) => new Date(2026, 9, day, h, m).getTime();
const cfg = { goalMl: 2000, reminders: true, remindEveryMin: 60, activeFrom: "08:00", activeTo: "22:00" };

describe("hidratação", () => {
  it("soma o dia local e separa por hora", () => {
    let s = initialWater();
    s = addEntry(s, 250, at(9, 10));
    s = addEntry(s, 500, at(9, 50));
    s = addEntry(s, 300, at(14));
    s = addEntry(s, 999, at(10, 0, 24)); // ontem
    expect(totalOn(s.entries, at(12))).toBe(1050);
    const h = hourly(s.entries, at(12));
    expect(h[9]).toBe(750);
    expect(h[14]).toBe(300);
    expect(dailyTotals(s.entries, at(12), 2)).toEqual([
      { day: new Date(2026, 9, 24).getTime(), ml: 999 },
      { day: new Date(2026, 9, 25).getTime(), ml: 1050 },
    ]);
  });

  it("desfazer só remove o último registro de hoje", () => {
    let s = addEntry(initialWater(), 999, at(10, 0, 24));
    expect(undoLast(s, at(12))).toBe(s);
    s = addEntry(s, 250, at(9));
    s = addEntry(s, 500, at(10));
    expect(totalOn(undoLast(s, at(12)).entries, at(12))).toBe(250);
  });

  it("limita a quantidade e descarta histórico antigo", () => {
    let s = addEntry(initialWater(), 100, new Date(2026, 4, 1, 9).getTime()); // > 120 dias antes
    s = addEntry(s, 99999, at(9));
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]?.ml).toBe(3000);
  });

  it("agenda o lembrete a partir do último gole, dentro da janela ativa", () => {
    const s = addEntry(initialWater(), 250, at(10));
    expect(nextReminder(s.entries, at(10, 5), cfg)).toBe(at(11));
    // antes da janela: primeiro lembrete às 09:00
    expect(nextReminder([], at(6), cfg)).toBe(at(9));
    // muito tempo sem beber (ex.: PC estava desligado): 5 min de folga, nunca na hora
    expect(nextReminder(s.entries, at(21, 30), cfg)).toBe(at(21, 35));
    // nada bebido hoje: um intervalo a partir de agora, não "atrasado"
    expect(nextReminder([], at(15), cfg)).toBe(at(16));
    // o próximo cairia depois da janela: amanhã
    expect(nextReminder(s.entries, at(22, 10), cfg)).toBe(at(9, 0, 26));
    // meta batida: amanhã
    const full = addEntry(s, 2000, at(11));
    expect(nextReminder(full.entries, at(11, 1), cfg)).toBe(at(9, 0, 26));
    // desligado
    expect(nextReminder(s.entries, at(10), { ...cfg, reminders: false })).toBeNull();
  });
});

describe("garrafa", () => {
  it("registra só o que desceu e enche sem contar consumo", () => {
    let s = setBottle(initialWater(), 750);
    expect(s.bottle).toEqual({ capacityMl: 750, levelMl: 750 });
    s = setLevel(s, 500, at(9));
    expect(totalOn(s.entries, at(12))).toBe(250);
    s = setLevel(s, 600, at(10)); // subiu: completou, não bebeu
    expect(totalOn(s.entries, at(12))).toBe(250);
    s = setLevel(s, 0, at(11));
    expect(totalOn(s.entries, at(12))).toBe(850);
    s = refill(s);
    expect(s.bottle?.levelMl).toBe(750);
    expect(totalOn(s.entries, at(12))).toBe(850);
  });

  it("desfazer devolve a água para a garrafa", () => {
    let s = setLevel(setBottle(initialWater(), 1000), 700, at(9));
    s = undoLast(s, at(12));
    expect(s.bottle?.levelMl).toBe(1000);
    expect(s.entries).toHaveLength(0);
  });

  it("limita capacidade e desenha de 4 a 12 faixas", () => {
    expect(setBottle(initialWater(), 10).bottle?.capacityMl).toBe(150);
    expect(setBottle(initialWater(), 99999).bottle?.capacityMl).toBe(5000);
    expect(segmentsFor(150)).toBe(4);
    expect(segmentsFor(500)).toBe(5);
    expect(segmentsFor(1500)).toBe(12);
  });
});
