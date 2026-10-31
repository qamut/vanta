import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { CheckCircle2, CircleAlert, CircleDashed, ExternalLink, FolderOpen, Keyboard, PlugZap, RefreshCw, Trash2, Wifi } from "../../components/icons";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { Button, Segmented, Slider, Toggle } from "../../components/ui";
import { errorMessage, inTauri, ipc } from "../../lib/ipc";
import { useT } from "../../lib/i18n";
import { formatBytes } from "../../lib/time";
import type { BridgeStatus, MediaSnapshot, MonitorInfo, PingResult, StoreUsage, SystemInfo } from "../../types";
import { openDialog } from "../../lib/dialog";
import { isWanted, sourceKey } from "../media/filter";
import { waterActions } from "../water/store";
import { Group, Row } from "./controls";
import { LANGUAGES, type Settings } from "./schema";

const PRIVACY_URL = "https://vanta.notrix.com.br/privacidade";
import { patchSettings, useSettings } from "./store";

function useGroup<K extends keyof Omit<Settings, "version">>(k: K): [Settings[K], (p: Partial<Settings[K]>) => void] {
  const v = useSettings((s) => s.value[k]);
  return [v, (p) => patchSettings(k, p)];
}

function Num(props: { id: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (v: number) => void; label: string }) {
  return (
    <span className="st-num">
      <input
        id={props.id}
        className="vt-input"
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)));
        }}
      />
      <span>{props.suffix}</span>
    </span>
  );
}

// ------------------------------------------------------------------ atalho

const CODE_NAMES: Record<string, string> = { Space: "Space", Enter: "Enter", Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/" };

export function acceleratorFromEvent(e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code">): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_NAMES[e.code]) key = CODE_NAMES[e.code] ?? null;
  if (!key) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  if (mods.length === 0) return null;
  return [...mods, key].join("+");
}

function ShortcutField() {
  const t = useT();
  const [g, set] = useGroup("general");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = async (acc: string) => {
    setRecording(false);
    try {
      if (inTauri()) await ipc.setGlobalShortcut(acc || null);
      set({ shortcut: acc });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <span className="st-shortcut">
      <button
        className={`st-keys ${recording ? "is-recording" : ""}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          if (e.key === "Escape") return setRecording(false);
          const acc = acceleratorFromEvent(e);
          if (acc) void apply(acc);
        }}
        aria-label={t("settings.general.shortcut")}
      >
        <Keyboard size={14} aria-hidden />
        {recording ? t("settings.general.shortcutRecording") : g.shortcut ? g.shortcut.split("+").map((k) => <kbd key={k}>{k}</kbd>) : t("settings.general.shortcutNone")}
      </button>
      {g.shortcut && (
        <Button size="sm" variant="ghost" onClick={() => void apply("")}>
          {t("settings.general.shortcutClear")}
        </Button>
      )}
      {error && <span className="st-error">{error}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ Geral

export function GeneralSection() {
  const t = useT();
  const [g, set] = useGroup("general");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!inTauri()) return;
    void autostartEnabled().then(setAutostart).catch(() => setAutostart(false));
    void ipc.listMonitors().then(setMonitors).catch(() => {});
  }, []);
  return (
    <>
      <Group title={t("settings.group.startup")}>
        <Row label={t("settings.general.autostart")} hint={t("settings.general.autostartHint")}>
          <Toggle
            label={t("settings.general.autostart")}
            checked={!!autostart}
            disabled={autostart === null}
            onChange={async (v) => {
              try {
                await (v ? enableAutostart() : disableAutostart());
                setAutostart(await autostartEnabled());
                setErr(null);
              } catch (e) {
                setErr(errorMessage(e));
              }
            }}
          />
        </Row>
        {err && <span className="st-error">{err}</span>}
        <Row label={t("settings.general.language")}>
          <Segmented
            label={t("settings.general.language")}
            value={g.language}
            onChange={(language) => set({ language })}
            options={LANGUAGES.map((l) => ({ value: l, label: l === "pt-BR" ? "Português (Brasil)" : "English" }))}
          />
        </Row>
      </Group>
      <Group title={t("settings.group.capsule")}>
        <Row label={t("settings.general.desktopOnly")} hint={t("settings.general.desktopOnlyHint")}>
          <Toggle label={t("settings.general.desktopOnly")} checked={g.desktopOnly} onChange={(desktopOnly) => set({ desktopOnly })} />
        </Row>
        <Row label={t("settings.general.show")} hint={t("settings.general.showHint")}>
          <Toggle label={t("settings.general.show")} checked={g.showIsland} onChange={(showIsland) => set({ showIsland })} />
        </Row>
        <Row label={t("settings.general.visibility")} hint={t("settings.general.visibilityHint")}>
          <Segmented
            label={t("settings.general.visibility")}
            value={g.visibility}
            onChange={(visibility) => set({ visibility })}
            options={[
              { value: "hideFullscreen", label: t("settings.general.visibility.hideFullscreen") },
              { value: "always", label: t("settings.general.visibility.always") },
            ]}
          />
        </Row>
        <Row label={t("settings.general.monitor")} htmlFor="monitor">
          <select id="monitor" className="vt-input" value={g.monitor ?? ""} onChange={(e) => set({ monitor: e.target.value || null })}>
            <option value="">{t("settings.general.monitorPrimary")}</option>
            {monitors.map((m, i) => (
              <option key={m.name} value={m.name}>
                {t("settings.general.monitorItem", { n: i + 1, w: m.width, h: m.height, scale: Math.round(m.scale * 100) })}
                {m.primary ? ` · ${t("settings.general.primary")}` : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("settings.general.offset")} hint={`${g.offsetY}px`}>
          <Slider label={t("settings.general.offset")} min={0} max={24} value={g.offsetY} onChange={(offsetY) => set({ offsetY })} className="vt-slider--accent st-slider" />
        </Row>
      </Group>
      <Group title={t("settings.group.interaction")}>
        <Row label={t("settings.general.expandOn")} hint={t("settings.general.expandOnHint")}>
          <Segmented
            label={t("settings.general.expandOn")}
            value={g.expandOn}
            onChange={(expandOn) => set({ expandOn })}
            options={[
              { value: "hover", label: t("settings.general.expandOn.hover") },
              { value: "click", label: t("settings.general.expandOn.click") },
            ]}
          />
        </Row>
        {g.expandOn === "hover" && (
          <Row label={t("settings.general.hoverDelay")} hint={`${g.hoverDelayMs} ms`}>
            <Slider label={t("settings.general.hoverDelay")} min={0} max={1200} step={20} value={g.hoverDelayMs} onChange={(hoverDelayMs) => set({ hoverDelayMs })} className="vt-slider--accent st-slider" />
          </Row>
        )}
        <Row label={t("settings.general.collapseOnBlur")} hint={t("settings.general.collapseOnBlurHint")}>
          <Toggle label={t("settings.general.collapseOnBlur")} checked={g.collapseOnBlur} onChange={(collapseOnBlur) => set({ collapseOnBlur })} />
        </Row>
        <Row label={t("settings.general.shortcut")} hint={t("settings.general.shortcutHint")}>
          <ShortcutField />
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Aparência

export function AppearanceSection() {
  const t = useT();
  const [a, set] = useGroup("appearance");
  return (
    <>
      <div className="st-preview" aria-hidden>
        <span className="st-preview__capsule">
          <span className="vt-eyes">
            <span />
            <span />
          </span>
        </span>
      </div>
      <Group title={t("settings.group.color")}>
        <Row label={t("settings.appearance.accent")} hint={`${a.accent}%`}>
          <Slider label={t("settings.appearance.accent")} min={0} max={100} value={a.accent} onChange={(accent) => set({ accent })} className="vt-slider--accent st-slider" />
        </Row>
        <Row label={t("settings.appearance.glow")} hint={`${a.glow}%`}>
          <Slider label={t("settings.appearance.glow")} min={0} max={100} value={a.glow} onChange={(glow) => set({ glow })} className="vt-slider--accent st-slider" />
        </Row>
        <Row label={t("settings.appearance.opacity")} hint={`${a.opacity}%`}>
          <Slider label={t("settings.appearance.opacity")} min={70} max={100} value={a.opacity} onChange={(opacity) => set({ opacity })} className="vt-slider--accent st-slider" />
        </Row>
      </Group>
      <Group title={t("settings.group.layout")}>
        <Row label={t("settings.appearance.size")}>
          <Segmented
            label={t("settings.appearance.size")}
            value={a.size}
            onChange={(size) => set({ size })}
            options={[
              { value: "s", label: t("settings.appearance.size.s") },
              { value: "m", label: t("settings.appearance.size.m") },
              { value: "l", label: t("settings.appearance.size.l") },
            ]}
          />
        </Row>
        <Row label={t("settings.appearance.density")}>
          <Segmented
            label={t("settings.appearance.density")}
            value={a.density}
            onChange={(density) => set({ density })}
            options={[
              { value: "comfortable", label: t("settings.appearance.density.comfortable") },
              { value: "compact", label: t("settings.appearance.density.compact") },
            ]}
          />
        </Row>
        <Row label={t("settings.appearance.compactStyle")} hint={t("settings.appearance.compactStyleHint")}>
          <Segmented
            label={t("settings.appearance.compactStyle")}
            value={a.compactStyle}
            onChange={(compactStyle) => set({ compactStyle })}
            options={[
              { value: "eyes", label: t("settings.appearance.compactStyle.eyes") },
              { value: "summary", label: t("settings.appearance.compactStyle.summary") },
            ]}
          />
        </Row>
        <Row label={t("settings.appearance.idle")} hint={a.idleAfterMin === 0 ? t("settings.appearance.idleNever") : t("settings.appearance.idleAfter", { n: a.idleAfterMin })}>
          <Slider label={t("settings.appearance.idle")} min={0} max={60} value={a.idleAfterMin} onChange={(idleAfterMin) => set({ idleAfterMin })} className="vt-slider--accent st-slider" />
        </Row>
      </Group>
      <Group title={t("settings.group.motion")}>
        <Row label={t("settings.appearance.speed")}>
          <Segmented
            label={t("settings.appearance.speed")}
            value={a.speed}
            onChange={(speed) => set({ speed })}
            options={[
              { value: "slow", label: t("settings.appearance.speed.slow") },
              { value: "normal", label: t("settings.appearance.speed.normal") },
              { value: "fast", label: t("settings.appearance.speed.fast") },
            ]}
          />
        </Row>
        <Row label={t("settings.appearance.reducedMotion")} hint={t("settings.appearance.reducedMotionHint")}>
          <Segmented
            label={t("settings.appearance.reducedMotion")}
            value={a.reducedMotion}
            onChange={(reducedMotion) => set({ reducedMotion })}
            options={[
              { value: "system", label: t("settings.appearance.reducedMotion.system") },
              { value: "on", label: t("settings.appearance.reducedMotion.on") },
              { value: "off", label: t("settings.appearance.reducedMotion.off") },
            ]}
          />
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Mídia

export function MediaSection() {
  const t = useT();
  const [m, set] = useGroup("media");
  const [snap, setSnap] = useState<MediaSnapshot | null>(null);
  const load = useCallback(() => {
    if (inTauri()) void ipc.mediaSnapshot().then(setSnap).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const apps = [...new Map((snap?.sessions ?? []).map((s) => [s.app.brand || s.app.name.toLowerCase(), s.app.name])).entries()];
  return (
    <>
      <Group title={t("settings.group.sessions")}>
        <Row label={t("settings.media.policy")} hint={t(`settings.media.policy.${m.policy}Hint`)}>
          <Segmented
            label={t("settings.media.policy")}
            value={m.policy}
            onChange={(policy) => set({ policy })}
            options={[
              { value: "smart", label: t("settings.media.policy.smart") },
              { value: "system", label: t("settings.media.policy.system") },
              { value: "manual", label: t("settings.media.policy.manual") },
            ]}
          />
        </Row>
        <Row label={t("settings.media.preferred")} hint={t("settings.media.preferredHint")} htmlFor="pref">
          <select id="pref" className="vt-input" value={m.preferredApp ?? ""} onChange={(e) => set({ preferredApp: e.target.value || null })}>
            <option value="">{t("settings.media.preferredNone")}</option>
            {m.preferredApp && !apps.some(([k]) => k === m.preferredApp) && <option value={m.preferredApp}>{m.preferredApp}</option>}
            {apps.map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
        </Row>
      </Group>
      <Group title={t("settings.group.sources")}>
        <p className="st-note">{t("settings.media.sourcesLead")}</p>
        <Row label={t("settings.media.browserVideos")} hint={t("settings.media.browserVideosHint")}>
          <Toggle label={t("settings.media.browserVideos")} checked={m.browserVideos} onChange={(browserVideos) => set({ browserVideos })} />
        </Row>
        <Row label={t("settings.media.extraApps")} hint={t("settings.media.extraAppsHint")}>
          <Toggle label={t("settings.media.extraApps")} checked={m.extraApps} onChange={(extraApps) => set({ extraApps })} />
        </Row>
        {m.blocked.length > 0 && (
          <Row label={t("settings.media.blocked")} hint={t("settings.media.blockedHint")}>
            <span className="st-chips">
              {m.blocked.map((b) => (
                <button key={b} className="st-chip" onClick={() => set({ blocked: m.blocked.filter((x) => x !== b) })} aria-label={t("settings.media.unblock", { name: b })}>
                  {b} <span aria-hidden>×</span>
                </button>
              ))}
            </span>
          </Row>
        )}
      </Group>
      <Group title={t("settings.group.display")}>
        <Row label={t("settings.media.artwork")}>
          <Toggle label={t("settings.media.artwork")} checked={m.showArtwork} onChange={(showArtwork) => set({ showArtwork })} />
        </Row>
        <Row label={t("settings.media.seek")} hint={t("settings.media.seekHint")}>
          <Toggle label={t("settings.media.seek")} checked={m.showSeek} onChange={(showSeek) => set({ showSeek })} />
        </Row>
        <Row label={t("settings.media.skip")}>
          <Toggle label={t("settings.media.skip")} checked={m.showSkip} onChange={(showSkip) => set({ showSkip })} />
        </Row>
        <Row label={t("settings.media.peek")} hint={t("settings.media.peekHint")}>
          <Toggle label={t("settings.media.peek")} checked={m.peekOnTrackChange} onChange={(peekOnTrackChange) => set({ peekOnTrackChange })} />
        </Row>
        <Row label={t("settings.media.onlineLyrics")} hint={t("settings.media.onlineLyricsHint")}>
          <span className="st-inline">
            <Button size="sm" variant="ghost" onClick={() => inTauri() && void ipc.lyricsClearCache()}>
              {t("settings.media.clearLyricsCache")}
            </Button>
            <Toggle label={t("settings.media.onlineLyrics")} checked={m.onlineLyrics} onChange={(onlineLyrics) => set({ onlineLyrics })} />
          </span>
        </Row>
      </Group>
      <Group
        title={t("settings.group.diagnostics")}
        aside={
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => (inTauri() ? void ipc.mediaRefresh().then(() => setTimeout(load, 400)) : undefined)}>
            {t("common.refresh")}
          </Button>
        }
      >
        <p className="st-note">{snap?.available === false ? t("settings.media.apiDown", { err: snap.error ?? "" }) : t("settings.media.apiOk")}</p>
        {(snap?.sessions.length ?? 0) === 0 ? (
          <p className="st-note">{t("settings.media.noSessions")}</p>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>{t("settings.media.col.source")}</th>
                <th>{t("settings.media.col.title")}</th>
                <th>{t("settings.media.col.state")}</th>
                <th>{t("settings.media.col.controls")}</th>
                <th>{t("settings.media.col.island")}</th>
              </tr>
            </thead>
            <tbody>
              {(snap?.sessions ?? []).map((s) => (
                <tr key={s.id}>
                  <td title={s.appId}>
                    {s.app.name}
                    <small>{t(`settings.media.resolved.${s.app.resolvedBy}`)}</small>
                  </td>
                  <td>{s.title || "—"}</td>
                  <td>{t(`media.status.${s.status}`)}</td>
                  <td className="st-caps">
                    {(["toggle", "previous", "next", "seek"] as const).map((c) => (
                      <span key={c} className={s.controls[c] ? "is-on" : ""}>
                        {t(`settings.media.cap.${c}`)}
                      </span>
                    ))}
                    {!s.timeline && <span>{t("settings.media.noTimeline")}</span>}
                  </td>
                  <td>
                    {isWanted(s, m) ? (
                      <Button size="sm" variant="ghost" onClick={() => set({ blocked: [...m.blocked, sourceKey(s)] })}>{t("settings.media.hide")}</Button>
                    ) : m.blocked.includes(sourceKey(s)) ? (
                      <Button size="sm" variant="ghost" onClick={() => set({ blocked: m.blocked.filter((x) => x !== sourceKey(s)) })}>{t("settings.media.show")}</Button>
                    ) : (
                      <small>{t("settings.media.ignored")}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Navegadores

export function BrowsersSection() {
  const t = useT();
  const [m, set] = useGroup("media");
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [ping, setPing] = useState<PingResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (inTauri()) void ipc.bridgeStatus().then(setStatus).catch((e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
      load();
    }
  };
  const registered = status?.browsers.some((b) => b.registered) ?? false;
  return (
    <>
      <p className="st-lead">{t("settings.browsers.lead")}</p>
      <Group title={t("settings.group.bridge")}>
        <Row label={t("settings.browsers.use")} hint={t("settings.browsers.useHint")}>
          <Toggle label={t("settings.browsers.use")} checked={m.useBrowserBridge} onChange={(useBrowserBridge) => set({ useBrowserBridge })} />
        </Row>
        <Row label={t("settings.browsers.local")} hint={status?.error ?? (status?.listening ? t("settings.browsers.listening") : t("settings.browsers.notListening"))}>
          <StatusPill ok={!!status?.listening} />
        </Row>
        <Row label={t("settings.browsers.host")} hint={registered ? t("settings.browsers.hostRegistered") : t("settings.browsers.hostNotRegistered")}>
          <span className="st-inline">
            <Button size="sm" variant={registered ? "soft" : "accent"} icon={PlugZap} disabled={busy} onClick={() => void run(ipc.bridgeRegister)}>
              {registered ? t("settings.browsers.reregister") : t("settings.browsers.register")}
            </Button>
            {registered && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(ipc.bridgeUnregister)}>
                {t("settings.browsers.unregister")}
              </Button>
            )}
          </span>
        </Row>
        <Row label={t("settings.browsers.connection")} hint={status?.connections.length ? t("settings.browsers.connected", { list: status.connections.map((c) => `${c.browser} ${c.version}`).join(", ") }) : t("settings.browsers.noConnection")}>
          <span className="st-inline">
            <StatusPill ok={(status?.connections.length ?? 0) > 0} />
            <Button size="sm" icon={Wifi} disabled={busy || !status?.connections.length} onClick={() => void run(async () => setPing(await ipc.bridgePing()))}>
              {t("settings.browsers.test")}
            </Button>
          </span>
        </Row>
        {ping && (
          <ul className="st-list">
            {ping.length === 0 && <li>{t("settings.browsers.pingNone")}</li>}
            {ping.map((p, i) => (
              <li key={i} className={p.ok ? "is-ok" : "is-bad"}>
                {p.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />} {p.browser}: {p.ok ? t("settings.browsers.pingOk", { ms: p.rttMs ?? 0 }) : t("settings.browsers.pingFail")}
              </li>
            ))}
          </ul>
        )}
        {err && <span className="st-error">{err}</span>}
      </Group>
      <Group title={t("settings.group.detected")}>
        <ul className="st-list">
          {(status?.browsers ?? []).map((b) => (
            <li key={b.id}>
              {b.installed ? <CheckCircle2 size={14} className="is-ok" /> : <CircleDashed size={14} />}
              <strong>{b.name}</strong>
              <span>
                {b.installed ? t("settings.browsers.installed") : t("settings.browsers.notInstalled")} · {b.registered ? t("settings.browsers.hostOk") : t("settings.browsers.hostMissing")}
              </span>
            </li>
          ))}
        </ul>
      </Group>
      <Group title={t("settings.group.install")}>
        <ol className="st-steps">
          <li>{t("settings.browsers.step1")}</li>
          <li>{t("settings.browsers.step2")}</li>
          <li>
            {t("settings.browsers.step3")}{" "}
            <Button size="sm" icon={FolderOpen} onClick={() => void ipc.openExtensionFolder().catch((e) => setErr(errorMessage(e)))}>
              {t("settings.browsers.openFolder")}
            </Button>
          </li>
          <li>{t("settings.browsers.step4", { id: status?.extensionId ?? "" })}</li>
          <li>{t("settings.browsers.step5")}</li>
        </ol>
        <p className="st-note">{t("settings.browsers.firefox")}</p>
      </Group>
      <Group title={t("settings.group.permissions")}>
        <ul className="st-bullets">
          <li>{t("settings.browsers.perm1")}</li>
          <li>{t("settings.browsers.perm2")}</li>
          <li>{t("settings.browsers.perm3")}</li>
          <li>{t("settings.browsers.perm4")}</li>
        </ul>
      </Group>
    </>
  );
}

function StatusPill(props: { ok: boolean }) {
  const t = useT();
  return <span className={`st-pill ${props.ok ? "is-ok" : ""}`}>{props.ok ? t("common.active") : t("common.inactive")}</span>;
}

// ------------------------------------------------------------------ Produtividade

export function ProductivitySection() {
  const t = useT();
  const [w, setW] = useGroup("water");
  const [tk, setT] = useGroup("tasks");
  const min = t("common.minutes");
  return (
    <>
      <Group title={t("settings.group.water")}>
        <Row label={t("settings.water.goal")} htmlFor="w1">
          <Num id="w1" label={t("settings.water.goal")} value={w.goalMl} min={250} max={8000} step={50} suffix="ml" onChange={(goalMl) => setW({ goalMl })} />
        </Row>
        <Row label={t("settings.water.bottle")} hint={t("settings.water.bottleHint")}>
          <Button size="sm" variant="ghost" onClick={waterActions.forgetBottle}>{t("water.bottle.change")}</Button>
        </Row>
        <Row label={t("settings.water.reminders")}>
          <Toggle label={t("settings.water.reminders")} checked={w.reminders} onChange={(reminders) => setW({ reminders })} />
        </Row>
        <Row label={t("settings.water.every")} htmlFor="w3">
          <Num id="w3" label={t("settings.water.every")} value={w.remindEveryMin} min={15} max={240} step={5} suffix={min} onChange={(remindEveryMin) => setW({ remindEveryMin })} />
        </Row>
        <Row label={t("settings.water.window")} hint={t("settings.water.windowHint")}>
          <span className="st-inline">
            <input className="vt-input" type="time" aria-label={t("settings.water.from")} value={w.activeFrom} onChange={(e) => e.target.value && setW({ activeFrom: e.target.value })} />
            <span className="st-sep">–</span>
            <input className="vt-input" type="time" aria-label={t("settings.water.to")} value={w.activeTo} onChange={(e) => e.target.value && setW({ activeTo: e.target.value })} />
          </span>
        </Row>
      </Group>
      <Group title={t("settings.group.tasks")}>
        <Row label={t("settings.tasks.sort")}>
          <Segmented
            label={t("settings.tasks.sort")}
            value={tk.sort}
            onChange={(sort) => setT({ sort })}
            options={[
              { value: "priority", label: t("tasks.sort.priority") },
              { value: "due", label: t("tasks.sort.due") },
              { value: "created", label: t("tasks.sort.created") },
            ]}
          />
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Ferramentas

function FolderRow(props: { label: string; hint: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  const t = useT();
  const pick = async () => {
    if (!inTauri()) return;
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") props.onChange(dir);
  };
  return (
    <Row label={props.label} hint={props.hint}>
      <span className="st-inline st-folder">
        <span className="st-folder__path" title={props.value ?? props.fallback}>{props.value ?? props.fallback}</span>
        <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void pick()}>{t("settings.tools.choose")}</Button>
        {props.value && <Button size="sm" variant="ghost" onClick={() => props.onChange(null)}>{t("settings.tools.reset")}</Button>}
      </span>
    </Row>
  );
}

export function ToolsSection() {
  const t = useT();
  const [tl, set] = useGroup("tools");
  return (
    <>
      <Group title={t("settings.group.convert")}>
        <FolderRow
          label={t("settings.tools.convertFolder")}
          hint={t("settings.tools.convertFolderHint")}
          value={tl.convertFolder}
          fallback={t("settings.tools.besideOriginal")}
          onChange={(convertFolder) => set({ convertFolder })}
        />
      </Group>
      <Group title={t("settings.group.download")}>
        <FolderRow
          label={t("settings.tools.downloadFolder")}
          hint={t("settings.tools.downloadFolderHint")}
          value={tl.downloadFolder}
          fallback={t("settings.tools.defaultDownloads")}
          onChange={(downloadFolder) => set({ downloadFolder })}
        />
        <Row label={t("tools.dl.mode")}>
          <Segmented
            label={t("tools.dl.mode")}
            value={tl.downloadMode}
            onChange={(downloadMode) => set({ downloadMode })}
            options={[
              { value: "video", label: t("tools.dl.video") },
              { value: "audio", label: t("tools.dl.audio") },
            ]}
          />
        </Row>
        <Row label={t("settings.tools.watch")} hint={t("settings.tools.watchHint")}>
          <Toggle label={t("settings.tools.watch")} checked={tl.watchClipboard} onChange={(watchClipboard) => set({ watchClipboard })} />
        </Row>
        <p className="st-note">{t("settings.tools.rights")}</p>
      </Group>
      <Group title={t("settings.group.credits")}>
        <p className="st-note">{t("settings.tools.credits")}</p>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Notificações

export function NotificationsSection() {
  const t = useT();
  const [n, set] = useGroup("notifications");
  return (
    <>
      <p className="st-lead">{t("settings.notifications.lead")}</p>
      <Group title={t("settings.group.categories")}>
        {(["water", "tasks", "tools", "integration"] as const).map((k) => (
          <Row key={k} label={t(`settings.notifications.${k}`)}>
            <Toggle label={t(`settings.notifications.${k}`)} checked={n[k]} onChange={(v) => set({ [k]: v })} />
          </Row>
        ))}
        <Row label={t("settings.notifications.sound")} hint={t("settings.notifications.soundHint")}>
          <Toggle label={t("settings.notifications.sound")} checked={n.sound} onChange={(sound) => set({ sound })} />
        </Row>
        <Row label={t("settings.notifications.inIsland")} hint={t("settings.notifications.inIslandHint")}>
          <Toggle label={t("settings.notifications.inIsland")} checked={n.inIsland} onChange={(inIsland) => set({ inIsland })} />
        </Row>
      </Group>
      <Group title={t("settings.group.system")}>
        <Row label={t("settings.notifications.windows")} hint={t("settings.notifications.windowsHint")}>
          <Button size="sm" onClick={() => void ipc.openUri("ms-settings:notifications")}>{t("settings.notifications.openWindows")}</Button>
        </Row>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Privacidade

const DATA_KEYS = ["tasks", "water", "notifications", "media-prefs", "settings"] as const;

export function PrivacySection() {
  const t = useT();
  const [usage, setUsage] = useState<StoreUsage[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!inTauri()) return;
    void ipc.storeUsage().then(setUsage);
    void ipc.systemInfo().then(setInfo);
  }, []);
  useEffect(load, [load]);
  const clear = async (key: string) => {
    setConfirm(null);
    try {
      await ipc.storeClear(key);
      setMsg(t("settings.privacy.cleared", { what: t(`settings.privacy.key.${key}` as never) }));
      load();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <>
      <p className="st-lead">{t("settings.privacy.lead")}</p>
      <p>
        <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => void ipc.openUri(PRIVACY_URL).catch(() => {})}>
          {t("settings.privacy.policy")}
        </Button>
      </p>
      <Group title={t("settings.group.collected")}>
        <ul className="st-bullets">
          <li>{t("settings.privacy.c1")}</li>
          <li>{t("settings.privacy.c2")}</li>
          <li>{t("settings.privacy.c4")}</li>
          <li>{t("settings.privacy.c5")}</li>
          <li>{t("settings.privacy.c6")}</li>
        </ul>
      </Group>
      <Group
        title={t("settings.group.stored")}
        aside={
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void ipc.openAppFolder("data")}>
            {t("settings.privacy.openData")}
          </Button>
        }
      >
        <p className="st-note">{info?.dataDir}</p>
        {DATA_KEYS.map((k) => (
          <Row key={k} label={t(`settings.privacy.key.${k}`)} hint={formatBytes(usage.find((u) => u.key === k)?.bytes ?? 0)}>
            {confirm === k ? (
              <span className="st-inline">
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
                <Button size="sm" variant="danger" onClick={() => void clear(k)}>{t("settings.privacy.confirmClear")}</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirm(k)}>
                {t("settings.privacy.clear")}
              </Button>
            )}
          </Row>
        ))}
        {msg && <p className="st-note">{msg}</p>}
      </Group>
      <Group
        title={t("settings.group.logs")}
        aside={
          <span className="st-inline">
            <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void ipc.openAppFolder("logs")}>
              {t("settings.privacy.openLogs")}
            </Button>
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void ipc.clearLogs().then((n) => setMsg(t("settings.privacy.logsCleared", { n })))}>
              {t("settings.privacy.clearLogs")}
            </Button>
          </span>
        }
      >
        <p className="st-note">{t("settings.privacy.logsBody", { dir: info?.logDir ?? "" })}</p>
      </Group>
      <Group title={t("settings.group.permissions")}>
        <ul className="st-bullets">
          <li>{t("settings.privacy.p1")}</li>
          <li>{t("settings.privacy.p2")}</li>
          <li>{t("settings.privacy.p3")}</li>
          <li>{t("settings.privacy.p4")}</li>
        </ul>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Sobre

const CREDITS = ["Tauri 2", "React 19", "Motion", "Zustand", "Lucide", "Geist (Vercel)", "windows-rs", "Tokio", "Serde"];

export function AboutSection() {
  const t = useT();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    if (inTauri()) void ipc.systemInfo().then(setInfo);
  }, []);
  return (
    <>
      <div className="st-about">
        <span className="st-logo is-big" aria-hidden>
          <span />
          <span />
        </span>
        <div>
          <strong>VANTA</strong>
          <span>{t("settings.about.tagline")}</span>
          <span className="tabular">{t("settings.about.version", { v: info?.version ?? "—" })}</span>
        </div>
      </div>
      <Group title={t("settings.group.technical")}>
        <dl className="st-dl">
          <dt>Tauri</dt>
          <dd>{info?.tauriVersion ?? "—"}</dd>
          <dt>{t("settings.about.platform")}</dt>
          <dd>
            {info?.os} {info?.arch}
          </dd>
          <dt>{t("settings.about.build")}</dt>
          <dd>{info ? (info.debug ? t("settings.about.debug") : t("settings.about.release")) : "—"}</dd>
          <dt>{t("settings.about.systemMotion")}</dt>
          <dd>{info ? (info.reducedMotion ? t("settings.about.reduced") : t("settings.about.normal")) : "—"}</dd>
        </dl>
      </Group>
      <Group title={t("settings.group.updates")}>
        <p className="st-note">{t("settings.about.updates")}</p>
      </Group>
      <Group title={t("settings.group.credits")}>
        <p className="st-note">{CREDITS.join(" · ")}</p>
      </Group>
    </>
  );
}
