// Notificações do VANTA: central na ilha, aviso animado com o mascote, toast nativo do
// Windows com som e um toque sonoro próprio na ilha. Nunca replica notificações de outros apps.
import { create } from "zustand";
import { inTauri, ipc } from "../../lib/ipc";
import { createPersisted, isObj, oneOf, str, uid } from "../../lib/persisted";
import { useSettings } from "../settings/store";

export type NoticeCategory = "water" | "tasks" | "tools" | "integration";

export interface Notice {
  id: string;
  at: number;
  category: NoticeCategory;
  title: string;
  body: string;
  read: boolean;
}

export interface NoticesState {
  items: Notice[];
}

const LIMIT = 100;

export function sanitizeNotices(raw: unknown): NoticesState {
  const list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [];
  const items: Notice[] = [];
  for (const r of list.slice(-LIMIT)) {
    if (!isObj(r) || typeof r.id !== "string" || typeof r.at !== "number") continue;
    items.push({
      id: r.id.slice(0, 64),
      at: r.at,
      category: oneOf(r.category, ["water", "tasks", "tools", "integration"] as const, "integration"),
      title: str(r.title, "", 120),
      body: str(r.body, "", 300),
      read: r.read === true,
    });
  }
  return { items };
}

export const useNotices = createPersisted<NoticesState>("notifications", () => ({ items: [] }), sanitizeNotices);

/** Alerta efêmero mostrado na própria ilha ("live activity"). */
export interface LiveAlert {
  id: string;
  kind: "power" | "audio" | "notice" | "media" | "link";
  icon: string;
  title: string;
  detail: string;
  value?: string;
  tone?: "accent" | "success" | "warning" | "danger";
  until: number;
  /** Módulo aberto ao clicar no alerta. */
  module?: string;
}

interface AlertState {
  current: LiveAlert | null;
  show: (a: Omit<LiveAlert, "id" | "until">, ms?: number) => void;
  dismiss: () => void;
}

export const useAlerts = create<AlertState>((set) => ({
  current: null,
  show: (a, ms = 4200) => {
    set({ current: { ...a, id: uid(), until: Date.now() + ms } });
    if (useSettings.getState().value.notifications.sound) chime(a.tone ?? "accent");
  },
  dismiss: () => set({ current: null }),
}));

let audio: AudioContext | null = null;

/** Toque curto da ilha (duas notas suaves), sintetizado — sem arquivo de som. */
export function chime(tone: NonNullable<LiveAlert["tone"]>) {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const now = ctx.currentTime;
    const notes = tone === "warning" || tone === "danger" ? [659.25, 523.25] : [783.99, 1174.66];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const t = now + i * 0.11;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  } catch {
    // Sem áudio disponível: o aviso visual continua.
  }
}

/**
 * Registra a notificação na central, mostra o aviso animado na ilha e, quando pedido, envia o
 * toast nativo do Windows (com som, se ligado). Lembretes de água e tarefas já saem como toast
 * pelo agendador nativo; aqui eles só passam pela central e pela ilha.
 */
export function pushNotice(
  n: Omit<Notice, "id" | "at" | "read">,
  opts: { native?: boolean; module?: string; tone?: LiveAlert["tone"] } = {},
) {
  const settings = useSettings.getState().value.notifications;
  if (!settings[n.category]) return;
  useNotices.getState().set((s) => ({
    items: [...s.items, { ...n, id: uid(), at: Date.now(), read: false }].slice(-LIMIT),
  }));
  if (settings.inIsland) {
    useAlerts.getState().show({
      kind: "notice",
      icon: n.category,
      title: n.title,
      detail: n.body,
      tone: opts.tone ?? (n.category === "integration" ? "warning" : "accent"),
      module: opts.module ?? "notifications",
    });
  }
  if (opts.native && inTauri()) void ipc.notifyNow(n.title, n.body.slice(0, 280), settings.sound).catch(() => {});
}

export function markAllRead() {
  useNotices.getState().set((s) => ({ items: s.items.map((i) => (i.read ? i : { ...i, read: true })) }));
}

export function clearNotices() {
  useNotices.getState().set({ items: [] });
}
