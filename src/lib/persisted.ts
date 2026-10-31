// Estado persistido por chave (arquivo JSON gerido pelo Rust), com:
// - sanitização na leitura (dados antigos ou corrompidos nunca quebram a interface);
// - gravação agrupada (debounce) para não escrever no disco a cada clique;
// - sincronização entre janelas: quando as Configurações gravam, a cápsula relê.
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { inTauri, ipc, on } from "./ipc";

export interface Persisted<T> {
  value: T;
  loaded: boolean;
  /** Erro da última gravação, para a interface poder avisar. */
  saveError: string | null;
  set: (updater: T | ((prev: T) => T)) => void;
  reload: () => Promise<void>;
  reset: () => void;
  flush: () => Promise<void>;
}

const currentLabel = (): string => {
  try {
    return inTauri() ? getCurrentWebviewWindow().label : "test";
  } catch {
    return "unknown";
  }
};

export function createPersisted<T>(
  key: string,
  defaults: () => T,
  sanitize: (raw: unknown) => T,
  delayMs = 250,
): UseBoundStore<StoreApi<Persisted<T>>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  const store = create<Persisted<T>>((set, get) => ({
    value: defaults(),
    loaded: false,
    saveError: null,
    set: (updater) => {
      const prev = get().value;
      const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
      if (Object.is(next, prev)) return;
      set({ value: next });
      pending = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().flush(), delayMs);
    },
    flush: async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const v = pending;
      pending = null;
      if (v === null || !inTauri()) return;
      try {
        await ipc.storeSet(key, v);
        if (get().saveError) set({ saveError: null });
      } catch (e) {
        set({ saveError: String((e as { message?: string })?.message ?? e) });
      }
    },
    reload: async () => {
      if (!inTauri()) {
        set({ loaded: true });
        return;
      }
      try {
        const raw = await ipc.storeGet(key);
        set({ value: raw == null ? defaults() : sanitize(raw), loaded: true });
      } catch {
        set({ value: defaults(), loaded: true });
      }
    },
    reset: () => get().set(defaults()),
  }));

  void store.getState().reload();
  const self = currentLabel();
  void on("store://changed", (p) => {
    if (p.key === key && p.source !== self) void store.getState().reload();
  });
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => void store.getState().flush());
  }
  return store;
}

// ---- auxiliares de sanitização ----------------------------------------------

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function num(v: unknown, fallback: number, min: number, max: number, integer = false): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const c = Math.min(max, Math.max(min, n));
  return integer ? Math.round(c) : c;
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function str(v: unknown, fallback: string, max = 500): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
