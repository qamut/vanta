// Moldura da cápsula expandida: título do módulo, relógio/estado, navegação entre módulos.
// A moldura fica montada enquanto a cápsula está aberta; só o corpo troca, deslizando para
// o lado da navegação — o cabeçalho não pisca.
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useState, type ReactNode } from "react";
import { Bell, ChevronLeft, ChevronRight, Copy, Droplet, LayoutGrid, ListChecks, Music, Settings, Upload, type IconType } from "../../components/icons";
import { Mascot } from "../../components/Mascot";
import { IconButton, Ring, Wave, useNow } from "../../components/ui";
import { useT, type Key } from "../../lib/i18n";
import { useDevices } from "../devices/store";
import type { Track } from "../media/selection";
import { useSettings } from "../settings/store";
import type { Module } from "./machine";

export const MODULE_META: Record<Module, { icon: IconType; title: Key; accent?: Key }> = {
  music: { icon: Music, title: "module.music" },
  convert: { icon: Copy, title: "module.convert" },
  download: { icon: Upload, title: "module.download" },
  tasks: { icon: ListChecks, title: "module.tasks", accent: "module.tasksAccent" },
  water: { icon: Droplet, title: "module.water", accent: "module.waterAccent" },
  notifications: { icon: Bell, title: "module.notifications" },
};

export const moduleName = (t: (k: Key) => string, m: Module) => {
  const meta = MODULE_META[m];
  return meta.accent && t(meta.accent) ? `${t(meta.title)} ${t(meta.accent)}` : t(meta.title);
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Status(props: { track: Track | null }) {
  const lang = useSettings((s) => s.value.general.language);
  const t = useT();
  const now = useNow(30_000);
  const power = useDevices((s) => s.power);
  const d = new Date(now);
  return (
    <span className="vt-frame__status">
      {power?.hasBattery && power.percent !== null && (
        <Ring
          value={power.percent / 100}
          size={15}
          stroke={2.4}
          color={power.battery === "charging" ? "var(--success)" : power.percent <= 20 ? "var(--danger)" : "var(--success)"}
          label={`${power.percent}%`}
        />
      )}
      <span className="vt-frame__date">{capitalize(d.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" }))}</span>
      <span className="tabular vt-frame__time">{d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}</span>
      {props.track?.playing && <Wave playing bars={4} label={t("media.playingIndicator")} />}
    </span>
  );
}

/** Corpo do módulo: entra pelo lado da navegação, sai pelo oposto, com desfoque. */
const bodyVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 42, filter: "blur(10px)", scale: 0.985 }),
  center: { opacity: 1, x: 0, filter: "blur(0px)", scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -34, filter: "blur(8px)", scale: 0.985 }),
};

export function Frame(props: {
  module: Module;
  modules: readonly Module[];
  dir: 1 | -1;
  track: Track | null;
  onSelect: (m: Module) => void;
  onNext: () => void;
  onPrev: () => void;
  onSettings: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const [grid, setGrid] = useState(false);
  const meta = MODULE_META[props.module];
  const Icon = meta.icon;
  return (
    <div className="vt-frame">
      <header className="vt-frame__head">
        <button className="vt-frame__title" onClick={() => setGrid((g) => !g)} aria-expanded={grid} aria-label={t("island.modules")}>
          <Icon size={18} aria-hidden />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={props.module}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
              transition={{ type: "spring", visualDuration: 0.42, bounce: 0.2 }}
            >
              {t(meta.title)}
              {meta.accent && t(meta.accent) && <em>{t(meta.accent)}</em>}
            </motion.span>
          </AnimatePresence>
          <LayoutGrid size={13} className="vt-frame__grid-hint" aria-hidden />
        </button>
        <Status track={props.track} />
        <Mascot variant="head" size={26} className="vt-frame__buddy" />
        <IconButton icon={Settings} size="sm" label={t("island.openSettings")} onClick={props.onSettings} />
      </header>

      <div className="vt-frame__body">
        <AnimatePresence mode="popLayout" initial={false} custom={props.dir}>
          {grid ? (
            <motion.div
              key="grid"
              className="vt-grid"
              initial={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }}
              transition={{ type: "spring", visualDuration: 0.4, bounce: 0.18 }}
            >
              {props.modules.map((m, i) => {
                const M = MODULE_META[m];
                const MI = M.icon;
                return (
                  <motion.button
                    key={m}
                    className={`vt-grid__item ${m === props.module ? "is-active" : ""}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.028 } }}
                    onClick={() => {
                      props.onSelect(m);
                      setGrid(false);
                    }}
                  >
                    <MI size={22} aria-hidden />
                    <span>{moduleName(t, m)}</span>
                    <kbd>{i + 1}</kbd>
                  </motion.button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key={props.module}
              custom={props.dir}
              variants={bodyVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="vt-frame__panel vt-stagger"
              transition={{ type: "spring", visualDuration: 0.5, bounce: 0.16 }}
            >
              {props.children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <IconButton className="vt-frame__arrow is-left" icon={ChevronLeft} size="sm" variant="soft" label={t("island.prev")} onClick={props.onPrev} />
      <IconButton className="vt-frame__arrow is-right" icon={ChevronRight} size="sm" variant="soft" label={t("island.next")} onClick={props.onNext} />

      <nav className="vt-dots" aria-label={t("island.modules")}>
        {props.modules.map((m) => (
          <button key={m} className={m === props.module ? "is-active" : ""} aria-label={moduleName(t, m)} aria-current={m === props.module} onClick={() => props.onSelect(m)}>
            {m === props.module && <motion.span layoutId="dot" className="vt-dots__active" transition={{ type: "spring", visualDuration: 0.45, bounce: 0.28 }} />}
          </button>
        ))}
      </nav>
    </div>
  );
}
