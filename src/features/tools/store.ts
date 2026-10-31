// Conversor e downloader: fila de arquivos, trabalhos em andamento e o link copiado.
import { create } from "zustand";
import { errorCode, errorMessage, inTauri, ipc, on } from "../../lib/ipc";
import { tr } from "../../lib/i18n";
import type { DownloaderStatus, JobEvent, Probe } from "../../types";
import { pushNotice, useAlerts } from "../notifications/store";
import { useSettings } from "../settings/store";

/** Formatos de saída por tipo de entrada (espelha `targets_for` em tools.rs). */
export const TARGETS: Record<Probe["kind"], string[]> = {
  image: ["png", "jpg", "pdf", "webp", "ico", "bmp"],
  video: ["mp4", "webm", "mov", "gif", "mp3", "wav", "m4a"],
  audio: ["mp3", "wav", "m4a", "ogg", "flac", "opus"],
  pdf: ["png", "jpg", "webp"],
  other: [],
};

/** Sugestão de um clique: o destino mais provável para cada tipo. */
export function suggestTarget(p: Pick<Probe, "kind" | "ext">): string | null {
  const list = TARGETS[p.kind].filter((t) => t !== p.ext && !(t === "jpg" && p.ext === "jpeg"));
  if (p.kind === "image") return p.ext === "png" ? "jpg" : "png";
  if (p.kind === "video") return p.ext === "mp4" ? "mp3" : "mp4";
  if (p.kind === "audio") return p.ext === "mp3" ? "wav" : "mp3";
  if (p.kind === "pdf") return "png";
  return list[0] ?? null;
}

/** Pin, pasta ou pin.it: vira download de imagens (espelha `is_pinterest` em tools.rs). */
export const isPinterest = (url: string) => /^https:\/\/((www|[a-z]{2})\.)?pinterest\.[a-z.]{2,10}\/[^\s]+|^https:\/\/pin\.it\/\S+/i.test(url.trim());

/** Post do Instagram (/p/: fotos e carrosséis). Reels seguem como vídeo. */
export const isInstagramPost = (url: string) => /^https:\/\/(www\.|m\.)?instagram\.com\/([\w.]+\/)?p\/[\w-]+/i.test(url.trim());

/** O link vira download de imagens (gallery-dl)? Espelha `is_gallery_link` em tools.rs. */
export const isImageLink = (url: string) => isPinterest(url) || isInstagramPost(url);

export interface Pending extends Probe {
  target: string | null;
  /** Miniatura carregada depois (quadro, imagem, capa do áudio, 1ª página do PDF). */
  thumb?: string | null;
}

interface ToolsState {
  queue: Pending[];
  jobs: JobEvent[];
  downloader: DownloaderStatus | null;
  installing: boolean;
  url: string;
  error: string | null;
}

export const useTools = create<ToolsState>(() => ({ queue: [], jobs: [], downloader: null, installing: false, url: "", error: null }));

const MAX_JOBS = 20;

function upsertJob(ev: JobEvent) {
  useTools.setState((s) => {
    const prev = s.jobs.find((j) => j.id === ev.id);
    const rest = s.jobs.filter((j) => j.id !== ev.id);
    // a miniatura chega uma vez; os eventos seguintes não a apagam
    const next = { ...ev, thumb: ev.thumb ?? prev?.thumb ?? null };
    return { jobs: [next, ...rest].slice(0, MAX_JOBS) };
  });
}

export const toolsActions = {
  /** Arquivos soltos na ilha ou escolhidos: entram na fila com a sugestão já marcada. */
  addFiles: async (paths: string[]) => {
    if (!inTauri() || paths.length === 0) return;
    try {
      const probes = await ipc.toolsProbe(paths.slice(0, 50));
      const items = probes.map((p) => ({ ...p, target: suggestTarget(p) }));
      useTools.setState((s) => ({ queue: [...s.queue.filter((q) => !items.some((i) => i.path === q.path)), ...items], error: null }));
      // miniaturas em segundo plano, uma de cada vez (o ffmpeg não precisa abrir 50 de uma vez)
      for (const it of items) {
        if (it.kind === "other") continue;
        const thumb = await ipc.toolsThumb(it.path).catch(() => null);
        if (thumb) useTools.setState((s) => ({ queue: s.queue.map((q) => (q.path === it.path ? { ...q, thumb } : q)) }));
      }
    } catch (e) {
      useTools.setState({ error: errorMessage(e) });
    }
  },
  setTarget: (path: string, target: string) =>
    useTools.setState((s) => ({ queue: s.queue.map((q) => (q.path === path ? { ...q, target } : q)) })),
  /** "Todos para X": aplica a cada arquivo que aceita X; os outros ficam como estão. */
  setAllTargets: (target: string) =>
    useTools.setState((s) => ({ queue: s.queue.map((q) => (TARGETS[q.kind].includes(target) ? { ...q, target } : q)) })),
  remove: (path: string) => useTools.setState((s) => ({ queue: s.queue.filter((q) => q.path !== path) })),
  clearQueue: () => useTools.setState({ queue: [] }),
  /** Converte a fila para a pasta escolhida. Com `mergePdf`, as imagens marcadas como PDF viram um PDF só. */
  convertAll: async (folder: string | null, mergePdf = false) => {
    let items = useTools.getState().queue.filter((q) => q.target && q.kind !== "other");
    useTools.setState({ queue: [] });
    const pdfs = items.filter((q) => q.kind === "image" && q.target === "pdf");
    if (mergePdf && pdfs.length > 1) {
      try {
        await ipc.convertMergePdf(pdfs.map((q) => q.path), folder);
      } catch (e) {
        useTools.setState({ error: errorMessage(e) });
      }
      items = items.filter((q) => !pdfs.includes(q));
    }
    for (const it of items) {
      try {
        await ipc.convertStart(it.path, it.target as string, folder);
      } catch (e) {
        useTools.setState({ error: errorMessage(e) });
      }
    }
  },
  cancel: (id: string) => void ipc.jobCancel(id).catch(() => {}),
  dismiss: (id: string) => useTools.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  clearDone: () => useTools.setState((s) => ({ jobs: s.jobs.filter((j) => j.status === "running") })),

  setUrl: (url: string) => useTools.setState({ url }),
  refreshDownloader: async () => {
    if (!inTauri()) return;
    const folder = useSettings.getState().value.tools.downloadFolder;
    try {
      useTools.setState({ downloader: await ipc.downloaderStatus(folder) });
    } catch (e) {
      useTools.setState({ error: errorMessage(e) });
    }
  },
  installDownloader: async () => {
    useTools.setState({ installing: true, error: null });
    try {
      await ipc.downloaderInstall();
      await toolsActions.refreshDownloader();
    } catch (e) {
      useTools.setState({ error: errorMessage(e) });
    } finally {
      useTools.setState({ installing: false });
    }
  },
  download: async (url?: string) => {
    const link = (url ?? useTools.getState().url).trim();
    const { downloadMode, imageMode, downloadFolder } = useSettings.getState().value.tools;
    try {
      await ipc.downloadStart(link, isImageLink(link) ? imageMode : downloadMode, downloadFolder);
      useTools.setState({ url: "", error: null });
    } catch (e) {
      useTools.setState({ error: errorCode(e) === "not_installed" ? tr("tools.dl.needInstall") : errorMessage(e) });
    }
  },
};

const baseName = (p: string | null) => (p ? (p.split(/[\\/]/).pop() ?? p) : "");

let wired = false;
export function wireTools() {
  if (wired || !inTauri()) return;
  wired = true;
  void toolsActions.refreshDownloader();
  const syncWatch = () => void ipc.toolsSetWatch(useSettings.getState().value.tools.watchClipboard).catch(() => {});
  syncWatch();
  let prevWatch = useSettings.getState().value.tools.watchClipboard;
  useSettings.subscribe((s) => {
    if (s.value.tools.watchClipboard !== prevWatch) {
      prevWatch = s.value.tools.watchClipboard;
      syncWatch();
    }
  });

  void on("tools://downloader", () => void toolsActions.refreshDownloader());
  void on("tools://job", (ev) => {
    upsertJob(ev);
    if (ev.status === "done") {
      const title = ev.kind === "convert" ? tr("tools.notify.converted") : tr("tools.notify.downloaded");
      pushNotice({ category: "tools", title, body: baseName(ev.output) || ev.title }, { native: true, module: ev.kind === "convert" ? "convert" : "download" });
    } else if (ev.status === "error") {
      pushNotice(
        { category: "tools", title: ev.kind === "convert" ? tr("tools.notify.convertFailed") : tr("tools.notify.downloadFailed"), body: ev.error ?? ev.title },
        { native: true, module: ev.kind === "convert" ? "convert" : "download", tone: "warning" },
      );
    }
  });

  // Link de vídeo copiado: a ilha oferece baixar, sem baixar nada sozinha.
  void on("tools://link", ({ url, site }) => {
    useTools.setState({ url });
    useAlerts.getState().show(
      { kind: "link", icon: "download", title: tr("tools.link.title", { site }), detail: tr("tools.link.detail"), tone: "accent", module: "download" },
      6000,
    );
  });
}
