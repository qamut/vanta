import { createPersisted } from "../../lib/persisted";
import { defaultSettings, sanitizeSettings, type Settings } from "./schema";

export const useSettings = createPersisted<Settings>("settings", defaultSettings, sanitizeSettings, 200);

/** Atualiza um grupo de preferências sem tocar nos demais. */
export function patchSettings<K extends keyof Omit<Settings, "version">>(group: K, patch: Partial<Settings[K]>) {
  useSettings.getState().set((s) => ({ ...s, [group]: { ...s[group], ...patch } }));
}
