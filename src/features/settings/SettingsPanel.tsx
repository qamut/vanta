// Configurações DENTRO da cápsula: ela se amplia, mostra as categorias e, ao fechar,
// volta a ser a ilha pequena — sem janela separada.
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Bell, Copy, Globe, Info, ListChecks, Music, Palette, Settings, Shield, X, type IconType } from "../../components/icons";
import { Button, IconButton } from "../../components/ui";
import { useT, type Key } from "../../lib/i18n";
import { useSettings } from "./store";
import {
  AboutSection,
  AppearanceSection,
  BrowsersSection,
  GeneralSection,
  MediaSection,
  NotificationsSection,
  PrivacySection,
  ProductivitySection,
  ToolsSection,
} from "./sections";

export const SECTIONS: { id: string; icon: IconType; label: Key; render: () => ReactNode }[] = [
  { id: "general", icon: Settings, label: "settings.nav.general", render: () => <GeneralSection /> },
  { id: "appearance", icon: Palette, label: "settings.nav.appearance", render: () => <AppearanceSection /> },
  { id: "media", icon: Music, label: "settings.nav.media", render: () => <MediaSection /> },
  { id: "browsers", icon: Globe, label: "settings.nav.browsers", render: () => <BrowsersSection /> },
  { id: "tools", icon: Copy, label: "settings.nav.tools", render: () => <ToolsSection /> },
  { id: "productivity", icon: ListChecks, label: "settings.nav.productivity", render: () => <ProductivitySection /> },
  { id: "notifications", icon: Bell, label: "settings.nav.notifications", render: () => <NotificationsSection /> },
  { id: "privacy", icon: Shield, label: "settings.nav.privacy", render: () => <PrivacySection /> },
  { id: "about", icon: Info, label: "settings.nav.about", render: () => <AboutSection /> },
];

const FIRST = SECTIONS[0] as (typeof SECTIONS)[number];

export function SettingsPanel(props: { initial?: string; onClose: () => void }) {
  const t = useT();
  const saveError = useSettings((s) => s.saveError);
  const [active, setActive] = useState(() => (SECTIONS.some((s) => s.id === props.initial) ? (props.initial as string) : "general"));
  const [confirmReset, setConfirmReset] = useState(false);
  const section = SECTIONS.find((s) => s.id === active) ?? FIRST;

  return (
    <div className="st-panel">
      <nav className="st-nav" aria-label={t("settings.title")}>
        <div className="st-nav__brand">
          <span className="st-logo" aria-hidden>
            <span />
            <span />
          </span>
          <strong>{t("settings.title")}</strong>
        </div>
        {SECTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.button
              key={s.id}
              className={s.id === active ? "is-active" : ""}
              aria-current={s.id === active ? "page" : undefined}
              onClick={() => setActive(s.id)}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0, transition: { delay: 0.12 + i * 0.03, type: "spring", visualDuration: 0.4, bounce: 0.2 } }}
            >
              {s.id === active && <motion.span layoutId="st-pill" className="st-nav__pill" transition={{ type: "spring", visualDuration: 0.4, bounce: 0.2 }} />}
              <Icon size={18} aria-hidden />
              <span>{t(s.label)}</span>
            </motion.button>
          );
        })}
        <div className="st-nav__foot">
          {confirmReset ? (
            <div className="st-confirm">
              <span>{t("settings.resetConfirm")}</span>
              <div>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    useSettings.getState().reset();
                    setConfirmReset(false);
                  }}
                >
                  {t("settings.reset")}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
              {t("settings.reset")}
            </Button>
          )}
        </div>
      </nav>
      <main className="st-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section.id}
            className="st-page"
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ type: "spring", visualDuration: 0.42, bounce: 0.14 }}
          >
            <h2>{t(section.label)}</h2>
            {section.render()}
          </motion.div>
        </AnimatePresence>
        {saveError && (
          <div className="st-toast" role="alert">
            {t("settings.saveError")}: {saveError}
          </div>
        )}
      </main>
      <IconButton className="st-close" icon={X} size="md" variant="soft" label={t("settings.close")} onClick={props.onClose} />
    </div>
  );
}
