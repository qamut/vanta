// Preferências do VANTA: formato, padrões e sanitização.
// Toda leitura passa por `sanitizeSettings` — um arquivo editado à mão ou de uma versão
// antiga nunca entrega um valor fora do intervalo para a interface.
import { bool, isObj, num, oneOf, str } from "../../lib/persisted";

export const LANGUAGES = ["pt-BR", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Settings {
  version: 2;
  general: {
    language: Language;
    showIsland: boolean;
    expandOn: "hover" | "click";
    hoverDelayMs: number;
    visibility: "always" | "hideFullscreen";
    monitor: string | null;
    offsetY: number;
    /** Só na área de trabalho: a ilha fica atrás das janelas abertas. */
    desktopOnly: boolean;
    shortcut: string;
    collapseOnBlur: boolean;
  };
  appearance: {
    accent: number;
    glow: number;
    opacity: number;
    size: "s" | "m" | "l";
    speed: "slow" | "normal" | "fast";
    density: "compact" | "comfortable";
    reducedMotion: "system" | "on" | "off";
    compactStyle: "eyes" | "summary";
    idleAfterMin: number;
  };
  media: {
    policy: "smart" | "system" | "manual";
    preferredApp: string | null;
    showArtwork: boolean;
    showSeek: boolean;
    showSkip: boolean;
    peekOnTrackChange: boolean;
    useBrowserBridge: boolean;
    onlineLyrics: boolean;
    /** Largura da coluna da letra (px lógicos), ajustada pela divisória. */
    lyricsWidth: number;
    /** Aceitar players desconhecidos (além dos conhecidos e dos navegadores). */
    extraApps: boolean;
    /** Fontes bloqueadas pelo usuário (marca ou nome). */
    blocked: string[];
    /** Mostrar vídeos do navegador (YouTube, Netflix…) além de música. */
    browserVideos: boolean;
  };
  tools: {
    /** Pasta das conversões; null = ao lado do original. */
    convertFolder: string | null;
    /** Pasta dos downloads; null = Downloads\VANTA. */
    downloadFolder: string | null;
    downloadMode: "video" | "audio";
    /** Formato das imagens do Pinterest. */
    imageMode: "jpg" | "png";
    /** Avisar quando um link de vídeo for copiado. */
    watchClipboard: boolean;
  };
  water: {
    goalMl: number;
    glassMl: number;
    reminders: boolean;
    remindEveryMin: number;
    activeFrom: string;
    activeTo: string;
  };
  tasks: {
    sort: "priority" | "due" | "created";
    showCompleted: boolean;
  };
  notifications: {
    water: boolean;
    tasks: boolean;
    tools: boolean;
    integration: boolean;
    inIsland: boolean;
    sound: boolean;
  };
}

export const defaultSettings = (): Settings => ({
  version: 2,
  general: {
    language: "pt-BR",
    showIsland: true,
    expandOn: "hover",
    hoverDelayMs: 320,
    visibility: "hideFullscreen",
    monitor: null,
    offsetY: 0,
    desktopOnly: true,
    shortcut: "Alt+Shift+Space",
    collapseOnBlur: true,
  },
  appearance: {
    accent: 80,
    glow: 55,
    opacity: 100,
    size: "m",
    speed: "normal",
    density: "comfortable",
    reducedMotion: "system",
    compactStyle: "eyes",
    idleAfterMin: 10,
  },
  media: {
    policy: "smart",
    preferredApp: null,
    showArtwork: true,
    showSeek: true,
    showSkip: true,
    peekOnTrackChange: true,
    useBrowserBridge: true,
    onlineLyrics: true,
    lyricsWidth: 300,
    extraApps: false,
    blocked: [],
    browserVideos: false,
  },
  tools: { convertFolder: null, downloadFolder: null, downloadMode: "video", imageMode: "jpg", watchClipboard: true },
  water: { goalMl: 2000, glassMl: 250, reminders: true, remindEveryMin: 60, activeFrom: "08:00", activeTo: "22:00" },
  tasks: { sort: "priority", showCompleted: true },
  notifications: { water: true, tasks: true, tools: true, integration: true, inIsland: true, sound: true },
});

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const hm = (v: unknown, fb: string) => (typeof v === "string" && HM.test(v) ? v : fb);
const nullableStr = (v: unknown, max = 400): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const r = isObj(raw) ? raw : {};
  const g = isObj(r.general) ? r.general : {};
  const a = isObj(r.appearance) ? r.appearance : {};
  const m = isObj(r.media) ? r.media : {};
  const tl = isObj(r.tools) ? r.tools : {};
  const w = isObj(r.water) ? r.water : {};
  const t = isObj(r.tasks) ? r.tasks : {};
  const n = isObj(r.notifications) ? r.notifications : {};
  return {
    version: 2,
    general: {
      language: oneOf(g.language, LANGUAGES, d.general.language),
      showIsland: bool(g.showIsland, d.general.showIsland),
      expandOn: oneOf(g.expandOn, ["hover", "click"] as const, d.general.expandOn),
      hoverDelayMs: num(g.hoverDelayMs, d.general.hoverDelayMs, 0, 1500, true),
      visibility: oneOf(g.visibility, ["always", "hideFullscreen"] as const, d.general.visibility),
      monitor: nullableStr(g.monitor, 200),
      // v1 descia a ilha 6 px por padrão; na v2 ela é um notch colado ao topo. Só migra quem
      // ainda estava no padrão antigo — um valor escolhido à mão continua valendo.
      desktopOnly: bool(g.desktopOnly, d.general.desktopOnly),
      offsetY: r.version === 1 && g.offsetY === 6 ? 0 : num(g.offsetY, d.general.offsetY, 0, 24, true),
      shortcut: str(g.shortcut, d.general.shortcut, 64),
      collapseOnBlur: bool(g.collapseOnBlur, d.general.collapseOnBlur),
    },
    appearance: {
      accent: num(a.accent, d.appearance.accent, 0, 100, true),
      glow: num(a.glow, d.appearance.glow, 0, 100, true),
      opacity: num(a.opacity, d.appearance.opacity, 70, 100, true),
      size: oneOf(a.size, ["s", "m", "l"] as const, d.appearance.size),
      speed: oneOf(a.speed, ["slow", "normal", "fast"] as const, d.appearance.speed),
      density: oneOf(a.density, ["compact", "comfortable"] as const, d.appearance.density),
      reducedMotion: oneOf(a.reducedMotion, ["system", "on", "off"] as const, d.appearance.reducedMotion),
      compactStyle: oneOf(a.compactStyle, ["eyes", "summary"] as const, d.appearance.compactStyle),
      idleAfterMin: num(a.idleAfterMin, d.appearance.idleAfterMin, 0, 240, true),
    },
    media: {
      policy: oneOf(m.policy, ["smart", "system", "manual"] as const, d.media.policy),
      preferredApp: nullableStr(m.preferredApp, 200),
      showArtwork: bool(m.showArtwork, d.media.showArtwork),
      showSeek: bool(m.showSeek, d.media.showSeek),
      showSkip: bool(m.showSkip, d.media.showSkip),
      peekOnTrackChange: bool(m.peekOnTrackChange, d.media.peekOnTrackChange),
      useBrowserBridge: bool(m.useBrowserBridge, d.media.useBrowserBridge),
      onlineLyrics: bool(m.onlineLyrics, d.media.onlineLyrics),
      lyricsWidth: num(m.lyricsWidth, d.media.lyricsWidth, 220, 600, true),
      extraApps: bool(m.extraApps, d.media.extraApps),
      browserVideos: bool(m.browserVideos, d.media.browserVideos),
      blocked: Array.isArray(m.blocked) ? m.blocked.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 50) : [],
    },
    tools: {
      convertFolder: nullableStr(tl.convertFolder, 1000),
      downloadFolder: nullableStr(tl.downloadFolder, 1000),
      downloadMode: oneOf(tl.downloadMode, ["video", "audio"] as const, d.tools.downloadMode),
      imageMode: oneOf(tl.imageMode, ["jpg", "png"] as const, d.tools.imageMode),
      watchClipboard: bool(tl.watchClipboard, d.tools.watchClipboard),
    },
    water: {
      goalMl: num(w.goalMl, d.water.goalMl, 250, 8000, true),
      glassMl: num(w.glassMl, d.water.glassMl, 50, 1500, true),
      reminders: bool(w.reminders, d.water.reminders),
      remindEveryMin: num(w.remindEveryMin, d.water.remindEveryMin, 15, 240, true),
      activeFrom: hm(w.activeFrom, d.water.activeFrom),
      activeTo: hm(w.activeTo, d.water.activeTo),
    },
    tasks: {
      sort: oneOf(t.sort, ["priority", "due", "created"] as const, d.tasks.sort),
      showCompleted: bool(t.showCompleted, d.tasks.showCompleted),
    },
    notifications: {
      water: bool(n.water, d.notifications.water),
      tasks: bool(n.tasks, d.notifications.tasks),
      tools: bool(n.tools, d.notifications.tools),
      integration: bool(n.integration, d.notifications.integration),
      inIsland: bool(n.inIsland, d.notifications.inIsland),
      sound: bool(n.sound, d.notifications.sound),
    },
  };
}

export const SIZE_SCALE: Record<Settings["appearance"]["size"], number> = { s: 0.9, m: 1, l: 1.12 };
export const SPEED_FACTOR: Record<Settings["appearance"]["speed"], number> = { slow: 1.35, normal: 1, fast: 0.75 };
