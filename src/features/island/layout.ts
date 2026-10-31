// Tamanhos que o usuário escolheu ao redimensionar cada módulo (persistidos).
import { createPersisted, isObj, num } from "../../lib/persisted";
import { ALL_MODULES, type Module } from "./machine";

export interface LayoutState {
  sizes: Partial<Record<Module, { w: number; h: number }>>;
}

export function sanitizeLayout(raw: unknown): LayoutState {
  const sizes: LayoutState["sizes"] = {};
  const src = isObj(raw) && isObj(raw.sizes) ? raw.sizes : {};
  for (const m of ALL_MODULES) {
    const v = src[m];
    if (isObj(v)) sizes[m] = { w: num(v.w, 0, 200, 4000, true), h: num(v.h, 0, 100, 3000, true) };
  }
  return { sizes };
}

export const useLayout = createPersisted<LayoutState>("layout", () => ({ sizes: {} }), sanitizeLayout);

export function setCustomSize(m: Module, size: { w: number; h: number } | null) {
  useLayout.getState().set((s) => {
    const rest = Object.fromEntries(Object.entries(s.sizes).filter(([k]) => k !== m)) as LayoutState["sizes"];
    return { sizes: size ? { ...rest, [m]: size } : rest };
  });
}
