// Conteúdo da ilha recolhida. Cada vista é desenhada para a largura-alvo definida em machine.ts.
import { MascotEyes } from "../../components/Mascot";
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Bell,
  Bluetooth,
  Droplets,
  Headphones,
  ListChecks,
  Pause,
  PlugZap,
  Speaker,
  TriangleAlert,
  Upload,
  type IconType,
} from "../../components/icons";
import { Marquee, Ring, Wave, Glyph, useNow } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { useDevices } from "../devices/store";
import { Artwork, sourceLabel, useArtwork } from "../media/parts";
import type { Track } from "../media/selection";
import { useNotices, type LiveAlert } from "../notifications/store";
import { useSettings } from "../settings/store";
import { useTools } from "../tools/store";
import type { CompactView } from "./machine";

export function batteryIcon(percent: number | null, charging: boolean): IconType {
  if (charging) return BatteryCharging;
  if (percent === null) return PlugZap;
  if (percent > 70) return BatteryFull;
  if (percent > 30) return BatteryMedium;
  return BatteryLow;
}

function BatteryMini() {
  const power = useDevices((s) => s.power);
  if (!power?.hasBattery || power.percent === null) return null;
  const color = power.battery !== "charging" && power.percent <= 20 ? "var(--danger)" : "var(--success)";
  return <Ring value={power.percent / 100} size={17} stroke={2.6} color={color} label={`${power.percent}%`} />;
}

function Clock(props: { className?: string }) {
  const lang = useSettings((s) => s.value.general.language);
  const now = useNow(60_000);
  return <span className={`tabular ${props.className ?? ""}`}>{new Date(now).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}</span>;
}

const ALERT_ICONS: Record<string, IconType> = {
  charging: BatteryCharging,
  battery: PlugZap,
  bluetooth: Bluetooth,
  headphones: Headphones,
  speaker: Speaker,
  water: Droplets,
  tasks: ListChecks,
  tools: Upload,
  download: Upload,
  integration: TriangleAlert,
};

const TONE: Record<NonNullable<LiveAlert["tone"]>, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

function JobCompact() {
  const job = useTools((s) => s.jobs.find((j) => j.status === "running"));
  const t = useT();
  if (!job) return null;
  return (
    <span className="vt-c vt-c--job">
      <Ring value={job.progress ?? 0.06} size={20} stroke={2.8} color="var(--accent)" />
      <Marquee className="vt-c__title" text={job.kind === "convert" ? t("tools.compact.converting", { name: job.title }) : t("tools.compact.downloading", { name: job.title })} />
      <span className="tabular vt-c__timer">{job.progress === null ? "…" : `${Math.round(job.progress * 100)}%`}</span>
    </span>
  );
}

export function Compact(props: { view: CompactView; track: Track | null; alert: LiveAlert | null; hover: boolean }) {
  const t = useT();
  const { view, track } = props;
  const unread = useNotices((s) => s.value.items.filter((i) => !i.read).length);
  const { tint } = useArtwork(track);

  switch (view) {
    case "idle":
      return <span className="vt-c vt-c--idle" aria-label={t("island.idle")} />;
    case "resting":
      return (
        <span className="vt-c vt-c--resting">
          <MascotEyes height={19} hover={props.hover} />
          {unread > 0 && <span className="vt-c__badge" aria-label={t("island.unread", { n: unread })} />}
        </span>
      );
    case "summary":
      return (
        <span className="vt-c vt-c--summary">
          <BatteryMini />
          <Clock className="vt-c__clock" />
          {unread > 0 ? (
            <span className="vt-c__bell">
              <Bell size={14} aria-hidden /> <span className="tabular">{unread}</span>
            </span>
          ) : (
            <MascotEyes height={14} hover={props.hover} />
          )}
        </span>
      );
    case "job":
      return <JobCompact />;
    case "media":
    case "mediaPaused":
      if (!track) return null;
      return (
        <span className="vt-c vt-c--media">
          <Artwork track={track} size={22} radius={7} />
          <Marquee className="vt-c__title" text={track.title || sourceLabel(track)} />
          {track.playing ? (
            <Wave playing label={t("media.playingIndicator")} color={tint ? `rgb(${tint})` : undefined} />
          ) : (
            <Pause size={14} className="vt-c__paused" aria-label={t("media.status.paused")} fill="currentColor" />
          )}
        </span>
      );
    case "mediaPeek":
      if (!track) return null;
      return (
        <span className="vt-c vt-c--peek">
          <Artwork track={track} size={40} radius={11} />
          <span className="vt-c__stack">
            <Marquee className="vt-c__title is-strong" text={track.title || t("media.untitled")} />
            <span className="vt-c__sub">{[track.artist, sourceLabel(track)].filter(Boolean).join(" · ")}</span>
          </span>
          <Wave playing={track.playing} label={t("media.playingIndicator")} color={tint ? `rgb(${tint})` : undefined} />
        </span>
      );
    case "alert": {
      const a = props.alert;
      if (!a) return null;
      const color = TONE[a.tone ?? "accent"];
      return (
        <span className="vt-c vt-c--alert" role="status">
          <span className="vt-c__alert-icon" style={{ color, boxShadow: `inset 0 0 0 2px ${color}` }}>
            <Glyph icon={ALERT_ICONS[a.icon] ?? Bell} size={18} />
          </span>
          <span className="vt-c__stack">
            <span className="vt-c__title is-strong">{a.title}</span>
            <span className="vt-c__sub">{a.detail}</span>
          </span>
          {a.value && <span className="tabular vt-c__value">{a.value}</span>}
          <MascotEyes height={13} />
        </span>
      );
    }
  }
}
