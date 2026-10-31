// Peças visuais de mídia: capa, linha do tempo e rótulo de origem.
import { AnimatePresence, motion } from "motion/react";
import { AppWindow, Globe, Music2 } from "../../components/icons";
import { useEffect, useState } from "react";
import { Slider, useNow } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { clock } from "../../lib/time";
import { useSettings } from "../settings/store";
import { livePosition, type Track } from "./selection";
import { ensureArtwork, sendCommand, useMedia } from "./store";

export function useArtwork(track: Track | null): { url: string | null; tint: string | null } {
  const key = track?.artworkKey ?? null;
  const url = useMedia((s) => (key ? s.artwork[key] ?? null : null));
  const tint = useMedia((s) => (key ? s.tint[key] ?? null : null));
  useEffect(() => {
    void ensureArtwork(key);
  }, [key]);
  // Capas vindas da extensão (https) não são carregadas: a CSP do app bloqueia imagens
  // externas e o VANTA não faz requisições de rede por conta própria.
  return { url, tint };
}

export function Artwork(props: { track: Track | null; size: number; radius?: number }) {
  const showArtwork = useSettings((s) => s.value.media.showArtwork);
  const { url } = useArtwork(props.track);
  const r = props.radius ?? Math.round(props.size * 0.22);
  const Fallback = props.track?.source === "browser" || props.track?.session?.app.kind === "browser" ? Globe : props.track ? Music2 : AppWindow;
  return (
    <span className="vt-art" style={{ width: props.size, height: props.size, borderRadius: r }}>
      <AnimatePresence initial={false}>
        {showArtwork && url ? (
          <motion.img
            key={url}
            src={url}
            alt=""
            draggable={false}
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          />
        ) : (
          <motion.span key="ph" className="vt-art__ph" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Fallback size={Math.round(props.size * 0.38)} strokeWidth={1.6} aria-hidden />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** "Spotify", "YouTube · Chrome", "Fonte de mídia". */
export function sourceLabel(track: Track): string {
  if (track.siteName && track.source === "system") return `${track.siteName} · ${track.appName}`;
  if (track.siteName) return `${track.siteName} · ${track.appName.charAt(0).toUpperCase()}${track.appName.slice(1)}`;
  return track.appName;
}

export function Timeline(props: { track: Track; compact?: boolean; visible?: boolean }) {
  const t = useT();
  const { track } = props;
  const showSeek = useSettings((s) => s.value.media.showSeek);
  const now = useNow(500, track.playing && props.visible !== false);
  const pos = livePosition(track, now);
  const [drag, setDrag] = useState<number | null>(null);
  const dur = track.durationMs;
  if (pos === null || !dur) {
    return <div className="vt-timeline vt-timeline--none">{t("media.noTimeline")}</div>;
  }
  const value = drag ?? pos;
  const canSeek = track.canSeek && showSeek;
  return (
    <div className={`vt-timeline ${props.compact ? "is-compact" : ""}`}>
      <span className="tabular vt-timeline__time">{clock(value)}</span>
      {canSeek ? (
        <Slider
          className="vt-timeline__bar"
          label={t("media.seek")}
          min={0}
          max={dur}
          step={1000}
          value={value}
          format={(v) => clock(v)}
          onChange={setDrag}
          onCommit={(v) => {
            setDrag(null);
            void sendCommand(track, "seek", v);
          }}
        />
      ) : (
        <span className="vt-timeline__bar vt-progress" title={t("media.seekUnsupported")}>
          <span style={{ transform: `scaleX(${Math.min(1, value / dur)})` }} />
        </span>
      )}
      <span className="tabular vt-timeline__time">{clock(value - dur)}</span>
    </div>
  );
}
