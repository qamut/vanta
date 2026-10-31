// "Tocando agora": player e letra num painel só. A letra abre ao lado do player por padrão
// (quando a faixa tem letra); o botão da letra fecha e reabre.
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { MascotEmpty } from "../../components/Mascot";
import { ExternalLink, ListMusic, Lyrics as LyricsIcon, Pause, Play, RefreshCw, SkipBack, SkipForward, TriangleAlert } from "../../components/icons";
import { Button, IconButton, Marquee, useNow } from "../../components/ui";
import { inTauri, ipc } from "../../lib/ipc";
import { useT } from "../../lib/i18n";
import { activeLine, type Lyrics } from "../lyrics/lrc";
import { hasLyrics, useLyricsFor } from "../lyrics/store";
import { patchSettings, useSettings } from "../settings/store";
import { clampLyricsW, LYRICS_W, useLyricsLive, useLyricsWidth } from "./lyricsWidth";
import { Artwork, sourceLabel, Timeline } from "./parts";
import { livePosition, trackKey, type Track } from "./selection";
import { chooseSession, sendCommand, useActiveTrack, useMedia, useTracks } from "./store";

function Controls(props: { track: Track }) {
  const t = useT();
  const showSkip = useSettings((s) => s.value.media.showSkip);
  const pending = useMedia((s) => s.pending);
  const { track } = props;
  return (
    <div className="vt-controls">
      {showSkip && (
        <IconButton icon={SkipBack} label={t("media.previous")} size="md" disabled={!track.canPrevious} disabledReason={t("media.unsupportedBySource")} onClick={() => void sendCommand(track, "previous")} />
      )}
      <motion.span whileTap={{ scale: 0.86 }} className="vt-controls__main">
        <IconButton
          icon={track.playing ? Pause : Play}
          label={track.playing ? t("media.pause") : t("media.play")}
          size="lg"
          variant="accent"
          disabled={!track.canPlayPause || pending === "toggle"}
          disabledReason={t("media.unsupportedBySource")}
          onClick={() => void sendCommand(track, "toggle")}
        />
      </motion.span>
      {showSkip && (
        <IconButton icon={SkipForward} label={t("media.next")} size="md" disabled={!track.canNext} disabledReason={t("media.unsupportedBySource")} onClick={() => void sendCommand(track, "next")} />
      )}
    </div>
  );
}

function LyricsToggle(props: { track: Track; open: boolean; onToggle: () => void }) {
  const t = useT();
  const entry = useLyricsFor(props.track);
  const online = useSettings((s) => s.value.media.onlineLyrics);
  const reason = !online
    ? t("lyrics.disabledOffline")
    : entry.state === "loading"
      ? t("lyrics.loading")
      : entry.state === "instrumental"
        ? t("lyrics.instrumental")
        : entry.state === "error"
          ? t("lyrics.error")
          : t("lyrics.none");
  return (
    <IconButton
      icon={LyricsIcon}
      className={`vt-lyrics-toggle ${entry.state === "loading" ? "is-loading" : ""}`}
      label={props.open ? t("lyrics.hide") : t("lyrics.show")}
      pressed={props.open}
      disabled={!hasLyrics(entry) && !props.open}
      disabledReason={reason}
      onClick={props.onToggle}
    />
  );
}

const LINE = 34;

function SyncedLines(props: { lyrics: Extract<Lyrics, { kind: "synced" }>; track: Track }) {
  const now = useNow(200, props.track.playing);
  const pos = livePosition(props.track, now) ?? 0;
  const idx = activeLine(props.lyrics.lines, pos, props.lyrics.offsetMs);
  return (
    <div className="vt-lyrics__viewport">
      <motion.ol className="vt-lyrics__lines" animate={{ y: -Math.max(0, idx) * LINE + LINE * 1.6 }} transition={{ type: "spring", visualDuration: 0.6, bounce: 0.12 }}>
        {props.lyrics.lines.map((l, i) => {
          const dist = Math.abs(i - idx);
          return (
            <motion.li
              key={`${l.timeMs}-${i}`}
              style={{ height: LINE }}
              animate={{ opacity: i === idx ? 1 : Math.max(0.16, 0.5 - dist * 0.12), scale: i === idx ? 1.06 : 1, filter: i === idx ? "blur(0px)" : `blur(${Math.min(2.4, dist * 0.7)}px)` }}
              transition={{ type: "spring", visualDuration: 0.5, bounce: 0.15 }}
              className={i === idx ? "is-active" : ""}
            >
              {l.text || "♪"}
            </motion.li>
          );
        })}
      </motion.ol>
    </div>
  );
}

function LyricsColumn(props: { track: Track }) {
  const t = useT();
  const entry = useLyricsFor(props.track);
  if (entry.state === "ready") {
    return (
      <div className="vt-np__lyrics">
        {entry.lyrics.kind === "synced" ? (
          <SyncedLines lyrics={entry.lyrics} track={props.track} />
        ) : (
          <div className="vt-lyrics__plain" tabIndex={0} aria-label={t("lyrics.plainLabel")}>
            <p className="vt-lyrics__note">{t("lyrics.unsynced")}</p>
            {entry.lyrics.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
        <span className="vt-lyrics__credit">{t("lyrics.credit", { source: entry.source })}</span>
      </div>
    );
  }
  return (
    <div className="vt-np__lyrics is-empty">
      <span>{entry.state === "loading" ? t("lyrics.loading") : entry.state === "instrumental" ? t("lyrics.instrumental") : t("lyrics.none")}</span>
    </div>
  );
}

function SessionList(props: { active: Track; onClose: () => void }) {
  const t = useT();
  const tracks = useTracks();
  return (
    <motion.div
      className="vt-popover"
      role="listbox"
      aria-label={t("media.sessions")}
      initial={{ opacity: 0, y: -8, scale: 0.96, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -6, scale: 0.98, filter: "blur(4px)" }}
    >
      {tracks.map((tr) => (
        <button
          key={tr.id}
          role="option"
          aria-selected={tr.id === props.active.id}
          className={`vt-session ${tr.id === props.active.id ? "is-active" : ""}`}
          onClick={() => {
            chooseSession(tr.id);
            props.onClose();
          }}
        >
          <Artwork track={tr} size={32} radius={9} />
          <span className="vt-session__text">
            <strong>{tr.title || t("media.untitled")}</strong>
            <span>
              {sourceLabel(tr)} · {tr.playing ? t("media.status.playing") : t("media.status.paused")}
            </span>
          </span>
        </button>
      ))}
    </motion.div>
  );
}

/**
 * Divisória entre o player e a letra: arrastar para a esquerda alarga a letra (a ilha cresce junto),
 * para a direita estreita; duplo clique volta ao padrão. A ilha cresce para os dois lados, então a
 * largura muda o dobro do arrasto — assim a divisória acompanha o cursor.
 */
function LyricsSplitter() {
  const t = useT();
  const width = useLyricsWidth();
  const drag = useRef<{ x0: number; w0: number } | null>(null);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, w0: width };
    useLyricsLive.setState({ live: width });
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    useLyricsLive.setState({ live: clampLyricsW(drag.current.w0 - (e.clientX - drag.current.x0) * 2) });
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    const live = useLyricsLive.getState().live;
    if (live !== null) patchSettings("media", { lyricsWidth: live });
    useLyricsLive.setState({ live: null });
  };
  const nudge = (d: number) => patchSettings("media", { lyricsWidth: clampLyricsW(width + d) });
  return (
    <div
      className="vt-np__split"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("lyrics.resize")}
      aria-valuemin={LYRICS_W.min}
      aria-valuemax={LYRICS_W.max}
      aria-valuenow={width}
      tabIndex={0}
      title={t("lyrics.resize")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={() => patchSettings("media", { lyricsWidth: LYRICS_W.default })}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") nudge(20);
        else if (e.key === "ArrowRight") nudge(-20);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <span aria-hidden />
    </div>
  );
}

export function NowPlaying(props: { lyricsOpen: boolean; onToggleLyrics: () => void }) {
  const t = useT();
  const snapshot = useMedia((s) => s.snapshot);
  const err = useMedia((s) => s.lastError);
  const now = useNow(1000, !!err);
  const track = useActiveTrack();
  const tracks = useTracks();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const lyricsW = useLyricsWidth();

  if (inTauri() && snapshot === null) return <div className="vt-loading" aria-busy>{t("common.loading")}</div>;
  if (snapshot && !snapshot.available && tracks.length === 0) {
    return (
      <MascotEmpty
        title={t("media.unavailable.title")}
        body={snapshot.error ?? t("media.unavailable.body")}
        action={<Button icon={RefreshCw} size="sm" onClick={() => void ipc.mediaRefresh()}>{t("common.retry")}</Button>}
      />
    );
  }
  if (!track) return <MascotEmpty title={t("media.empty.title")} body={t("media.empty.body")} />;

  return (
    <div className={`vt-np ${props.lyricsOpen ? "has-lyrics" : ""}`} style={props.lyricsOpen ? { gridTemplateColumns: `minmax(0, 1fr) ${lyricsW}px` } : undefined}>
      <div className="vt-np__player">
        <div className="vt-np__top">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={track.artworkKey ?? trackKey(track)}
              className="vt-np__art"
              initial={{ opacity: 0, scale: 0.84, rotate: -5, filter: "blur(8px)" }}
              animate={{ opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.9, rotate: 4, filter: "blur(6px)" }}
              transition={{ type: "spring", visualDuration: 0.55, bounce: 0.24 }}
            >
              <Artwork track={track} size={76} radius={18} />
            </motion.span>
          </AnimatePresence>
          <div className="vt-np__meta">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={trackKey(track)}
                className="vt-np__text"
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                transition={{ type: "spring", visualDuration: 0.5, bounce: 0.18 }}
              >
                <Marquee className="vt-np__title" text={track.title || t("media.untitled")} />
                <span className="vt-np__sub">{[track.artist, track.album].filter(Boolean).join(" · ") || t("media.unknownArtist")}</span>
              </motion.div>
            </AnimatePresence>
            <span className="vt-chip">
              <span className={`vt-chip__dot ${track.playing ? "is-live" : ""}`} />
              {sourceLabel(track)}
            </span>
          </div>
          <div className="vt-np__corner">
            {tracks.length > 1 && <IconButton icon={ListMusic} size="sm" label={t("media.sessions")} pressed={sessionsOpen} onClick={() => setSessionsOpen((v) => !v)} />}
            {track.url && <IconButton icon={ExternalLink} size="sm" label={t("media.openSource")} onClick={() => track.url && void ipc.openUri(track.url).catch(() => {})} />}
          </div>
        </div>
        <Timeline track={track} />
        <div className="vt-np__row">
          <LyricsToggle track={track} open={props.lyricsOpen} onToggle={props.onToggleLyrics} />
          <Controls track={track} />
          <span className="vt-np__count">{tracks.length > 1 ? `+${tracks.length - 1}` : ""}</span>
        </div>
        <AnimatePresence>
          {err && now - err.at < 5000 && (
            <motion.div className="vt-inline-error vt-np__error" role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <TriangleAlert size={14} aria-hidden /> {err.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {props.lyricsOpen && (
          <motion.div
            key="lyrics"
            className="vt-np__side"
            initial={{ opacity: 0, x: 30, filter: "blur(10px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)", transition: { type: "spring", visualDuration: 0.55, bounce: 0.14, delay: 0.08 } }}
            exit={{ opacity: 0, x: 20, filter: "blur(8px)", transition: { duration: 0.16 } }}
          >
            <LyricsSplitter />
            <LyricsColumn track={track} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{sessionsOpen && <SessionList active={track} onClose={() => setSessionsOpen(false)} />}</AnimatePresence>
    </div>
  );
}
