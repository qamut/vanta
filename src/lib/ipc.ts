// Ponte tipada com os comandos Rust. Nenhum outro arquivo chama `invoke` diretamente.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Alarm,
  AlarmFired,
  AppErrorPayload,
  AudioState,
  BridgeStatus,
  BrowserInfo,
  BrowserTab,
  DownloaderStatus,
  JobEvent,
  Probe,
  FileStat,
  LyricsResult,
  MediaAction,
  MediaSnapshot,
  MonitorInfo,
  PingResult,
  PowerState,
  StoreUsage,
  SystemInfo,
} from "../types";

/** Está rodando dentro do Tauri (e não num navegador comum ou em testes)? */
export const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as AppErrorPayload).message);
  return String(e);
}

export function errorCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e) return String((e as AppErrorPayload).code);
  return null;
}

export const ipc = {
  storeGet: (key: string) => invoke<unknown>("store_get", { key }),
  storeSet: (key: string, value: unknown) => invoke<void>("store_set", { key, value }),
  storeClear: (key: string) => invoke<void>("store_clear", { key }),
  storeUsage: () => invoke<StoreUsage[]>("store_usage"),

  alarmSet: (alarm: Alarm) => invoke<void>("alarm_set", { alarm }),
  alarmCancel: (id: string, prefix = false) => invoke<number>("alarm_cancel", { id, prefix }),
  notifyNow: (title: string, body: string, sound = true) => invoke<void>("notify_now", { title, body, sound }),

  setHitRect: (rect: { x: number; y: number; w: number; h: number }) => invoke<void>("island_set_hit_rect", { rect }),
  setExpanded: (expanded: boolean) => invoke<void>("island_set_expanded", { expanded }),
  requestFocus: () => invoke<void>("island_request_focus"),
  releaseFocus: () => invoke<void>("island_release_focus"),
  applyIslandPrefs: (prefs: { visibility: string; monitor: string | null; show: boolean; offsetY: number; desktopOnly: boolean }) =>
    invoke<void>("island_apply_prefs", { prefs }),
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  dragStart: () => invoke<{ x: number; y: number; scale: number }>("island_drag_start"),
  setPosition: (x: number, y: number) => invoke<void>("island_set_position", { x: Math.round(x), y: Math.round(y) }),
  geometry: () => invoke<[number, number]>("island_geometry"),
  returnHome: (durationMs?: number) => invoke<void>("island_return_home", { durationMs: durationMs ?? null }),

  mediaSnapshot: () => invoke<MediaSnapshot>("media_snapshot"),
  mediaArtwork: (key: string) => invoke<string | null>("media_artwork", { key }),
  mediaCommand: (id: string, action: MediaAction, positionMs?: number) =>
    invoke<void>("media_command", { id, action, positionMs: positionMs ?? null }),
  mediaRefresh: () => invoke<void>("media_refresh"),

  powerState: () => invoke<PowerState>("power_state"),
  audioState: () => invoke<AudioState>("audio_state"),
  audioSetVolume: (level: number) => invoke<void>("audio_set_volume", { level }),
  audioSetMute: (muted: boolean) => invoke<void>("audio_set_mute", { muted }),

  bridgeStatus: () => invoke<BridgeStatus>("bridge_status"),
  bridgeTabs: () => invoke<BrowserTab[]>("bridge_tabs"),
  bridgeRegister: () => invoke<BrowserInfo[]>("bridge_register"),
  bridgeUnregister: () => invoke<BrowserInfo[]>("bridge_unregister"),
  bridgeCommand: (key: string, action: MediaAction, positionMs?: number) =>
    invoke<void>("bridge_command", { key, action, positionMs: positionMs ?? null }),
  bridgePing: () => invoke<PingResult[]>("bridge_ping"),

  filesStat: (paths: string[]) => invoke<FileStat[]>("files_stat", { paths }),
  filesOpen: (path: string, confirmedExecutable = false) =>
    invoke<void>("files_open", { path, confirmedExecutable }),
  filesReveal: (path: string) => invoke<void>("files_reveal", { path }),
  toolsProbe: (paths: string[]) => invoke<Probe[]>("tools_probe", { paths }),
  convertStart: (path: string, target: string, folder: string | null) => invoke<string>("convert_start", { path, target, folder }),
  toolsThumb: (path: string) => invoke<string | null>("tools_thumb", { path }),
  convertMergePdf: (paths: string[], folder: string | null) => invoke<string>("convert_merge_pdf", { paths, folder }),
  jobCancel: (id: string) => invoke<void>("job_cancel", { id }),
  downloaderStatus: (folder: string | null) => invoke<DownloaderStatus>("downloader_status", { folder }),
  downloaderInstall: () => invoke<string>("downloader_install"),
  downloadStart: (url: string, mode: "video" | "audio" | "jpg" | "png", folder: string | null) => invoke<string>("download_start", { url, mode, folder }),
  toolsSetWatch: (enabled: boolean) => invoke<void>("tools_set_watch", { enabled }),

  lyricsLookup: (artist: string, title: string, album: string, durationMs: number | null) =>
    invoke<LyricsResult>("lyrics_lookup", { artist, title, album, durationMs }),
  lyricsClearCache: () => invoke<void>("lyrics_clear_cache"),

  systemInfo: () => invoke<SystemInfo>("system_info"),
  openUri: (uri: string) => invoke<void>("open_uri", { uri }),
  openAppFolder: (which: "data" | "logs") => invoke<void>("open_app_folder", { which }),
  openExtensionFolder: () => invoke<void>("open_extension_folder"),
  clearLogs: () => invoke<number>("clear_logs"),
  openSettings: (section?: string) => invoke<void>("open_settings", { section: section ?? null }),
  setGlobalShortcut: (accelerator: string | null) => invoke<void>("set_global_shortcut", { accelerator }),
};

export type Events = {
  "media://snapshot": MediaSnapshot;
  "bridge://tabs": BrowserTab[];
  "bridge://connections": unknown;
  "power://state": PowerState;
  "audio://state": AudioState;
  "island://pointer": { inside: boolean };
  "island://outside-click": null;
  "island://shortcut": null;
  "island://visibility": boolean;
  "alarm://fired": AlarmFired;
  "store://changed": { key: string; source: string };
  "island://open-settings": string;
  "island://geometry": [number, number];
  "tools://job": JobEvent;
  "tools://link": { url: string; site: string };
  "tools://downloader": null;
};

export function on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Promise<UnlistenFn> {
  if (!inTauri()) return Promise.resolve(() => {});
  return listen<Events[K]>(event, (e) => handler(e.payload));
}
