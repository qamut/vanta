import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

describe("traduções", () => {
  it("en e pt-BR têm exatamente as mesmas chaves, sem textos vazios inesperados", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort());
    const allowedEmpty = new Set<string>();
    for (const [k, v] of Object.entries(en)) if (!allowedEmpty.has(k)) expect(v, k).not.toBe("");
  });

  it("as chaves montadas dinamicamente existem", () => {
    const dyn = [
      ...["tasks", "water", "notifications", "media-prefs", "settings"].map((k) => `settings.privacy.key.${k}`),
      ...["water", "tasks", "tools", "integration"].map((k) => `settings.notifications.${k}`),
    ];
    for (const k of dyn) expect(k in ptBR, k).toBe(true);
  });

  it("interpola variáveis e mantém marcadores desconhecidos", () => {
    expect(translate("pt-BR", "water.drink", { ml: 250 })).toBe("Beber 250 ml");
    expect(translate("en", "water.bottle.label", { level: 300 })).toBe("Bottle: 300 of {cap} ml");
    expect(translate("pt-BR", "notices.count", { n: 1 })).toBe("1 notificação");
    expect(translate("pt-BR", "notices.count", { n: 3 })).toBe("3 notificações");
    expect(translate("en", "notices.count", { n: 0 })).toBe("0 notifications");
  });
});
