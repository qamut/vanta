import { inTauri, ipc, on } from "../../lib/ipc";
import { tr } from "../../lib/i18n";
import { createPersisted, isObj, num } from "../../lib/persisted";
import { pushNotice } from "../notifications/store";
import { useSettings } from "../settings/store";
import { addEntry, BOTTLE_MAX, BOTTLE_MIN, initialWater, nextReminder, refill, setBottle, setLevel, totalOn, undoLast, type WaterState } from "./model";

const ALARM_ID = "water:reminder";

export function sanitizeWater(raw: unknown): WaterState {
  if (!isObj(raw) || !Array.isArray(raw.entries)) return initialWater();
  const b = isObj(raw.bottle) ? raw.bottle : null;
  const capacityMl = b ? num(b.capacityMl, 0, BOTTLE_MIN, BOTTLE_MAX, true) : 0;
  return {
    bottle: b ? { capacityMl, levelMl: num(b.levelMl, capacityMl, 0, capacityMl, true) } : null,
    entries: raw.entries
      .filter(isObj)
      .map((e) => ({ at: num(e.at, 0, 0, 8.64e15), ml: num(e.ml, 0, 0, 3000, true) }))
      .filter((e) => e.at > 0 && e.ml > 0)
      .slice(-5000),
  };
}

export const useWater = createPersisted<WaterState>("water", initialWater, sanitizeWater);

async function schedule() {
  if (!inTauri()) return;
  const settings = useSettings.getState().value;
  const at = nextReminder(useWater.getState().value.entries, Date.now(), settings.water);
  try {
    if (at === null) {
      await ipc.alarmCancel(ALARM_ID);
      return;
    }
    const total = totalOn(useWater.getState().value.entries, Date.now());
    await ipc.alarmSet({
      id: ALARM_ID,
      atMs: Math.round(at),
      title: tr("water.notify.title"),
      body: tr("water.notify.body", { left: Math.max(0, settings.water.goalMl - total) }),
      category: "water",
      notify: settings.notifications.water,
    });
  } catch {
    /* lembrete é conveniência */
  }
}

export const waterActions = {
  drink: (ml?: number) => {
    const amount = ml ?? useSettings.getState().value.water.glassMl;
    useWater.getState().set((s) => addEntry(s, amount, Date.now()));
    void schedule();
  },
  setBottle: (ml: number) => {
    useWater.getState().set((s) => setBottle(s, ml));
  },
  setLevel: (ml: number) => {
    useWater.getState().set((s) => setLevel(s, ml, Date.now()));
    void schedule();
  },
  refill: () => useWater.getState().set((s) => refill(s)),
  forgetBottle: () => useWater.getState().set((s) => ({ ...s, bottle: null })),
  undo: () => {
    useWater.getState().set((s) => undoLast(s, Date.now()));
    void schedule();
  },
};

let wired = false;
export function wireWater() {
  if (wired) return;
  wired = true;
  const start = () => void schedule();
  if (useWater.getState().loaded) start();
  else {
    const unsub = useWater.subscribe((s) => {
      if (s.loaded) {
        unsub();
        start();
      }
    });
  }
  void on("alarm://fired", (p) => {
    if (p.category !== "water") return;
    // Lembrete atrasado (PC estava desligado) não vira aviso na cápsula.
    if (p.lateMs < 15 * 60_000) {
      pushNotice({ category: "water", title: tr("water.notify.title"), body: tr("water.notify.short") }, { module: "water" });
    }
    void schedule();
  });
  let prev = JSON.stringify([useSettings.getState().value.water, useSettings.getState().value.notifications.water]);
  useSettings.subscribe((s) => {
    const cur = JSON.stringify([s.value.water, s.value.notifications.water]);
    if (cur !== prev) {
      prev = cur;
      void schedule();
    }
  });
}
