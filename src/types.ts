// Tipos espelhados das estruturas Rust (serde camelCase). Mantidos à mão e cobertos
// pelos testes de seleção/mesclagem de mídia, que usam exatamente estes formatos.

export type SourceKind = "browser" | "app" | "unknown";

export interface AppIdentity {
  name: string;
  kind: SourceKind;
  brand: string;
  resolvedBy: "shell" | "table" | "derived" | "neutral";
}

export type PlaybackStatus = "closed" | "opened" | "changing" | "stopped" | "playing" | "paused" | "unknown";
export type PlaybackKind = "music" | "video" | "image" | "unknown";

export interface Controls {
  play: boolean;
  pause: boolean;
  toggle: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
  shuffle: boolean;
  repeat: boolean;
}

export interface Timeline {
  startMs: number;
  endMs: number;
  positionMs: number;
  updatedAtMs: number;
  minSeekMs: number;
  maxSeekMs: number;
}

export interface MediaSession {
  id: string;
  appId: string;
  app: AppIdentity;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  subtitle: string;
  trackNumber: number;
  kind: PlaybackKind;
  status: PlaybackStatus;
  controls: Controls;
  timeline: Timeline | null;
  rate: number | null;
  shuffle: boolean | null;
  repeat: string | null;
  artworkKey: string | null;
}

export interface MediaSnapshot {
  available: boolean;
  error: string | null;
  sessions: MediaSession[];
  systemCurrentId: string | null;
  revision: number;
}

export interface BrowserTab {
  key: string;
  browser: string;
  tabId: number;
  domain: string;
  site: string;
  title: string;
  artist: string;
  album: string;
  url: string;
  artworkUrl: string;
  playing: boolean;
  positionMs: number | null;
  durationMs: number | null;
  canSeek: boolean;
  canNext: boolean;
  canPrevious: boolean;
  updatedAtMs: number;
}

export type MediaAction = "play" | "pause" | "toggle" | "next" | "previous" | "seek";

export interface PowerState {
  available: boolean;
  hasBattery: boolean;
  percent: number | null;
  battery: "charging" | "discharging" | "idle" | "none";
  plugged: boolean;
  supply: "adequate" | "inadequate" | "none";
  remainingDischargeMin: number | null;
  energySaver: boolean;
}

export interface AudioDevice {
  id: string;
  name: string;
  form: "headphones" | "headset" | "speakers" | "display" | "spdif" | "line" | "other";
  bus: "bluetooth" | "usb" | "internal" | "virtual" | "unknown";
  isDefault: boolean;
}

export interface AudioState {
  available: boolean;
  error: string | null;
  defaultOutput: AudioDevice | null;
  outputs: AudioDevice[];
  volume: number | null;
  muted: boolean | null;
  batteryAvailable: boolean;
}

export interface FileStat {
  path: string;
  name: string;
  exists: boolean;
  isDir: boolean;
  size: number | null;
  modifiedMs: number | null;
  ext: string;
  executable: boolean;
}

export interface LyricsResult {
  status: "synced" | "plain" | "instrumental" | "none";
  text: string;
  source: string;
  fetchedAtMs: number;
}

export interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

export interface SystemInfo {
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  dataDir: string;
  logDir: string;
  reducedMotion: boolean;
  debug: boolean;
}

export interface BrowserInfo {
  id: string;
  name: string;
  installed: boolean;
  registered: boolean;
}

export interface BridgeConn {
  browser: string;
  family: string;
  version: string;
  connectedAtMs: number;
  lastMessageMs: number;
}

export interface BridgeStatus {
  listening: boolean;
  error: string | null;
  connections: BridgeConn[];
  browsers: BrowserInfo[];
  extensionId: string;
  extensionDir: string | null;
  hostName: string;
}

export interface PingResult {
  browser: string;
  ok: boolean;
  rttMs: number | null;
}

export interface StoreUsage {
  key: string;
  bytes: number;
}

export interface Alarm {
  id: string;
  atMs: number;
  title: string;
  body: string;
  category: "water" | "tasks" | "tools" | "system";
  notify?: boolean;
}

export interface AlarmFired {
  id: string;
  category: Alarm["category"];
  atMs: number;
  lateMs: number;
}

export interface AppErrorPayload {
  code: string;
  message: string;
}

export interface Probe {
  path: string;
  name: string;
  ext: string;
  kind: "image" | "video" | "audio" | "pdf" | "other";
  size: number | null;
}

export interface JobEvent {
  id: string;
  kind: "convert" | "download";
  status: "running" | "done" | "error" | "canceled";
  progress: number | null;
  title: string;
  output: string | null;
  error: string | null;
  /** Miniatura (data URL): capa do vídeo baixado ou quadro do arquivo convertido. */
  thumb?: string | null;
}

export interface DownloaderStatus {
  installed: boolean;
  /** gallery-dl (imagens e pastas do Pinterest) instalado. */
  images: boolean;
  /** Instalação automática em andamento (logo após instalar o app). */
  installing: boolean;
  version: string | null;
  folder: string;
}
