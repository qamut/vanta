// Hidratação: registros em mililitros, metas diárias e o próximo lembrete.
import { DAY, MINUTE, atMinuteOfDay, parseHm, startOfDay } from "../../lib/time";

export interface WaterEntry {
  at: number;
  ml: number;
}

/** A garrafa do usuário: capacidade e quanto ainda tem dentro. */
export interface Bottle {
  capacityMl: number;
  levelMl: number;
}

export interface WaterState {
  entries: WaterEntry[];
  bottle: Bottle | null;
}

/** Guarda 120 dias de histórico. */
export const RETENTION_MS = 120 * DAY;
const OVERDUE_GRACE = 5 * MINUTE;

export const initialWater = (): WaterState => ({ entries: [], bottle: null });

export function addEntry(s: WaterState, ml: number, now: number): WaterState {
  const amount = Math.round(Math.min(3000, Math.max(1, ml)));
  const cutoff = now - RETENTION_MS;
  return { ...s, entries: [...s.entries.filter((e) => e.at >= cutoff), { at: now, ml: amount }] };
}

/** Desfaz o último registro de hoje (nunca apaga dias anteriores). */
export function undoLast(s: WaterState, now: number): WaterState {
  const today = startOfDay(now);
  const idx = s.entries.map((e) => e.at >= today).lastIndexOf(true);
  if (idx < 0) return s;
  const ml = s.entries[idx]?.ml ?? 0;
  const bottle = s.bottle ? { ...s.bottle, levelMl: Math.min(s.bottle.capacityMl, s.bottle.levelMl + ml) } : null;
  return { entries: s.entries.filter((_, i) => i !== idx), bottle };
}

// ---- garrafa ---------------------------------------------------------------

export const BOTTLE_MIN = 150;
export const BOTTLE_MAX = 5000;

/** Quantas faixas a garrafa desenha: ~100 ml por faixa, entre 4 e 12. */
export function segmentsFor(capacityMl: number): number {
  return Math.max(4, Math.min(12, Math.round(capacityMl / 100)));
}

export function setBottle(s: WaterState, capacityMl: number): WaterState {
  const cap = Math.round(Math.min(BOTTLE_MAX, Math.max(BOTTLE_MIN, capacityMl)));
  return { ...s, bottle: { capacityMl: cap, levelMl: cap } };
}

/** Encher a garrafa não conta como água bebida. */
export function refill(s: WaterState): WaterState {
  return s.bottle ? { ...s, bottle: { ...s.bottle, levelMl: s.bottle.capacityMl } } : s;
}

/**
 * O usuário marca até onde a água chegou. Se o nível desceu, a diferença foi bebida;
 * se subiu, ele completou a garrafa (não conta como consumo).
 */
export function setLevel(s: WaterState, levelMl: number, now: number): WaterState {
  if (!s.bottle) return s;
  const level = Math.round(Math.min(s.bottle.capacityMl, Math.max(0, levelMl)));
  const drunk = s.bottle.levelMl - level;
  const next = { ...s, bottle: { ...s.bottle, levelMl: level } };
  return drunk > 0 ? addEntry(next, drunk, now) : next;
}

export function totalOn(entries: WaterEntry[], dayTs: number): number {
  const from = startOfDay(dayTs);
  const to = from + DAY;
  return entries.filter((e) => e.at >= from && e.at < to).reduce((a, e) => a + e.ml, 0);
}

/** Consumo por hora do dia (24 posições). */
export function hourly(entries: WaterEntry[], dayTs: number): number[] {
  const out = new Array<number>(24).fill(0);
  const from = startOfDay(dayTs);
  for (const e of entries) {
    if (e.at < from || e.at >= from + DAY) continue;
    const h = new Date(e.at).getHours();
    out[h] = (out[h] ?? 0) + e.ml;
  }
  return out;
}

/** Totais dos últimos `days` dias (mais antigo primeiro). */
export function dailyTotals(entries: WaterEntry[], now: number, days: number): { day: number; ml: number }[] {
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i) * DAY;
    return { day, ml: totalOn(entries, day) };
  });
}

export interface ReminderConfig {
  goalMl: number;
  reminders: boolean;
  remindEveryMin: number;
  activeFrom: string;
  activeTo: string;
}

/**
 * Próximo lembrete: `remindEveryMin` depois do último gole (ou de agora), dentro da janela
 * ativa. Meta batida hoje = sem lembrete até a janela de amanhã.
 */
export function nextReminder(entries: WaterEntry[], now: number, cfg: ReminderConfig): number | null {
  if (!cfg.reminders) return null;
  const from = parseHm(cfg.activeFrom, 8 * 60);
  const to = parseHm(cfg.activeTo, 22 * 60);
  if (to <= from) return null;
  const interval = cfg.remindEveryMin * MINUTE;
  const todayStart = atMinuteOfDay(now, from);
  const todayEnd = atMinuteOfDay(now, to);
  const tomorrowFirst = atMinuteOfDay(now + DAY, from) + interval;

  if (totalOn(entries, now) >= cfg.goalMl) return tomorrowFirst;
  const lastToday = entries.filter((e) => e.at >= startOfDay(now) && e.at <= now).reduce((m, e) => Math.max(m, e.at), 0);
  // Um intervalo depois do último gole de hoje (ou de agora, se ainda não bebeu nada).
  // Atrasado — por exemplo depois de o PC ficar desligado — lembra em 5 min, nunca na hora.
  let next = Math.max(lastToday > 0 ? lastToday + interval : now + interval, now + OVERDUE_GRACE);
  if (next < todayStart + interval) next = todayStart + interval;
  if (next > todayEnd) return tomorrowFirst;
  return next;
}
