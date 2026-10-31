// Traduções. pt-BR é o idioma de referência; `en` precisa ter exatamente as mesmas chaves
// (garantido por teste). Interpolação simples: "{nome}".
import { useSettings } from "../features/settings/store";
import type { Language } from "../features/settings/schema";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

export type Key = keyof typeof ptBR;
const DICTS: Record<Language, Record<Key, string>> = { "pt-BR": ptBR, en };

export function translate(lang: Language, key: Key, vars?: Record<string, string | number>): string {
  let raw: string = DICTS[lang]?.[key] ?? ptBR[key] ?? key;
  // Plural simples: "singular|plural", escolhido por {n}.
  if (raw.includes("|") && vars && typeof vars.n === "number") {
    const [one, many] = raw.split("|");
    raw = (vars.n === 1 ? one : many) ?? raw;
  }
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function currentLang(): Language {
  return useSettings.getState().value.general.language;
}

/** Tradução fora de componentes (agendador, notificações). */
export const tr = (key: Key, vars?: Record<string, string | number>) => translate(currentLang(), key, vars);

export function useT() {
  const lang = useSettings((s) => s.value.general.language);
  return (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

export function useLocale(): string {
  return useSettings((s) => s.value.general.language);
}
