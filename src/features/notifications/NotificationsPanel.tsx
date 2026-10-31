import { AnimatePresence, motion } from "motion/react";
import { Bell, CheckCheck, Droplets, ListChecks, TriangleAlert, Trash2, Upload, type IconType } from "../../components/icons";
import { useEffect } from "react";
import { Button, useNow } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { clearNotices, markAllRead, useNotices, type NoticeCategory } from "./store";

export const NOTICE_ICON: Record<NoticeCategory, IconType> = {
  water: Droplets,
  tasks: ListChecks,
  tools: Upload,
  integration: TriangleAlert,
};

export function relativeTime(ts: number, now: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const s = Math.round((ts - now) / 1000);
  if (Math.abs(s) < 60) return rtf.format(Math.round(s), "second");
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rtf.format(m, "minute");
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}

export function NotificationsPanel(props: { locale: string }) {
  const t = useT();
  const items = useNotices((s) => s.value.items);
  const now = useNow(30_000);
  // Abrir a central conta como "lidas".
  useEffect(() => {
    const id = setTimeout(markAllRead, 1200);
    return () => clearTimeout(id);
  }, []);
  if (items.length === 0) return <p className="vt-quiet">{t("notices.emptyQuiet")}</p>;
  const list = [...items].reverse();
  return (
    <div className="vt-notices">
      <div className="vt-notices__bar">
        <span>
          <Bell size={13} aria-hidden /> {t("notices.count", { n: items.length })}
        </span>
        <span className="vt-notices__tools">
          <Button size="sm" variant="ghost" icon={CheckCheck} onClick={markAllRead}>{t("notices.markRead")}</Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={clearNotices}>{t("notices.clear")}</Button>
        </span>
      </div>
      <ul className="vt-notices__list">
        <AnimatePresence initial={false}>
          {list.map((n) => {
            const Icon = NOTICE_ICON[n.category];
            return (
              <motion.li key={n.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`vt-notice ${n.read ? "" : "is-unread"} is-${n.category}`}>
                <span className="vt-notice__icon">
                  <Icon size={15} aria-hidden />
                </span>
                <span className="vt-notice__text">
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                </span>
                <time className="vt-notice__time" dateTime={new Date(n.at).toISOString()}>
                  {relativeTime(n.at, now, props.locale)}
                </time>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
