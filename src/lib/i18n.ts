// Traduções. pt-BR é o idioma de referência; `en` precisa ter exatamente as mesmas chaves
// (garantido por teste). Interpolação simples: "{nome}".
import { useSettings } from "../features/settings/store";
import type { Language } from "../features/settings/schema";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

export type Key = keyof typeof ptBR;
const DICTS: Record<Language, Record<Key, string>> = { "pt-BR": ptBR, en };

/** O sistema em que o VANTA roda, para os textos que dizem "{os}" (Windows, macOS ou Linux). */
export const OS_NAME: string = (() => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "Linux";
  return "Windows";
})();

export function translate(lang: Language, key: Key, vars?: Record<string, string | number>): string {
  let raw: string = DICTS[lang]?.[key] ?? ptBR[key] ?? key;
  raw = raw.replace(/\{os\}/g, OS_NAME);
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
