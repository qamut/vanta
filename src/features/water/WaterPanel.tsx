// Água com garrafa: na primeira vez pergunta quantos ml tem a garrafa; depois desenha a
// garrafa em faixas e o usuário toca no nível em que a água ficou. O que desceu foi bebido.
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Mascot } from "../../components/Mascot";
import { BellOff, BellRing, Droplet, RotateCcw, Undo2 } from "../../components/icons";
import { Button, IconButton, useNow } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { keyboardProps } from "../island/focus";
import { patchSettings, useSettings } from "../settings/store";
import { BOTTLE_MAX, BOTTLE_MIN, segmentsFor, totalOn, type Bottle as BottleT } from "./model";
import { useWater, waterActions } from "./store";

export function formatLiters(ml: number, locale: string): string {
  return (ml / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

const PRESETS = [350, 500, 750, 1000, 1500];

function AskBottle() {
  const t = useT();
  const [value, setValue] = useState("");
  const ml = Number(value);
  const valid = Number.isFinite(ml) && ml >= BOTTLE_MIN && ml <= BOTTLE_MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) waterActions.setBottle(ml);
  };
  return (
    <div className="vt-ask">
      <Mascot variant="full" size={92} float />
      <form className="vt-ask__form" onSubmit={submit}>
        <strong>{t("water.ask.title")}</strong>
        <span className="vt-ask__sub">{t("water.ask.body")}</span>
        <div className="vt-ask__presets" role="group" aria-label={t("water.ask.presets")}>
          {PRESETS.map((p) => (
            <button type="button" key={p} className={ml === p ? "is-active" : ""} onClick={() => setValue(String(p))}>
              {p >= 1000 ? `${p / 1000} L` : `${p} ml`}
            </button>
          ))}
        </div>
        <span className="vt-ask__row">
          <input
            className="vt-input"
            inputMode="numeric"
            value={value}
            placeholder={t("water.ask.placeholder")}
            aria-label={t("water.ask.placeholder")}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
            {...keyboardProps}
          />
          <span className="vt-ask__unit">ml</span>
          <Button variant="accent" type="submit" disabled={!valid}>{t("water.ask.save")}</Button>
        </span>
      </form>
    </div>
  );
}

/** A garrafa: faixas de baixo para cima; tocar numa faixa define o nível até ela. */
function Bottle(props: { bottle: BottleT }) {
  const t = useT();
  const { capacityMl, levelMl } = props.bottle;
  const n = segmentsFor(capacityMl);
  const per = capacityMl / n;
  const filled = Math.round(levelMl / per);
  return (
    <div className="vt-bottle" role="group" aria-label={t("water.bottle.label", { level: levelMl, cap: capacityMl })}>
      <span className="vt-bottle__cap" aria-hidden />
      <span className="vt-bottle__neck" aria-hidden />
      <div className="vt-bottle__body">
        {Array.from({ length: n }, (_, i) => n - 1 - i).map((i) => {
          const on = i < filled;
          const target = Math.round((i + 1) * per);
          return (
            <motion.button
              key={i}
              className={`vt-bottle__seg ${on ? "is-on" : ""}`}
              aria-label={t("water.bottle.setLevel", { ml: target })}
              title={`${target} ml`}
              // Tocar na faixa mais alta cheia esvazia só ela (ajuste fino).
              onClick={() => waterActions.setLevel(on && i === filled - 1 ? Math.round(i * per) : target)}
              initial={false}
              animate={{ opacity: on ? 1 : 1, scaleY: on ? 1 : 0.96 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", visualDuration: 0.35, bounce: 0.3, delay: on ? (filled - i) * 0.02 : 0 }}
            />
          );
        })}
      </div>
      <span className="vt-bottle__level tabular">{levelMl} ml</span>
    </div>
  );
}

export function WaterPanel() {
  const t = useT();
  const water = useWater((s) => s.value);
  const w = useSettings((s) => s.value.water);
  const lang = useSettings((s) => s.value.general.language);
  const now = useNow(60_000);
  const [changing, setChanging] = useState(false);
  if (!water.bottle || changing) {
    return changing ? (
      <div className="vt-water2">
        <AskBottle />
        <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>{t("common.cancel")}</Button>
      </div>
    ) : (
      <AskBottle />
    );
  }
  const total = totalOn(water.entries, now);
  const pct = Math.min(1, total / w.goalMl);
  const left = Math.max(0, w.goalMl - total);
  return (
    <div className="vt-water2">
      <Bottle bottle={water.bottle} />
      <div className="vt-water2__info">
        <div className="vt-water__amount" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={total} className="tabular vt-water__big" initial={{ y: 12, opacity: 0, filter: "blur(4px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }} exit={{ y: -12, opacity: 0 }}>
              {formatLiters(total, lang)}
            </motion.span>
          </AnimatePresence>
          <span className="vt-water__goal">/ {formatLiters(w.goalMl, lang)} L</span>
        </div>
        <span className="vt-water__sub">
          {t("water.today")} · <b>{Math.round(pct * 100)}%</b> · {left === 0 ? t("water.goalReached") : t("water.left", { ml: left })}
        </span>
        <div className="vt-water__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
          <motion.span animate={{ scaleX: pct }} initial={false} transition={{ type: "spring", visualDuration: 0.6, bounce: 0.15 }} />
        </div>
        <p className="vt-water2__how">{t("water.bottle.how")}</p>
        <div className="vt-water__actions">
          <Button variant="accent" icon={Droplet} onClick={waterActions.refill} disabled={water.bottle.levelMl === water.bottle.capacityMl}>
            {t("water.bottle.refill")}
          </Button>
          <IconButton icon={Undo2} size="sm" label={t("water.undo")} disabled={total === 0} onClick={waterActions.undo} />
          <IconButton icon={RotateCcw} size="sm" label={t("water.bottle.change")} onClick={() => setChanging(true)} />
          <IconButton
            icon={w.reminders ? BellRing : BellOff}
            size="sm"
            pressed={w.reminders}
            label={w.reminders ? t("water.remindersOn") : t("water.remindersOff")}
            onClick={() => patchSettings("water", { reminders: !w.reminders })}
          />
        </div>
      </div>
    </div>
  );
}
