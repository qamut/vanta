// Conversor: solte (ou escolha) vários arquivos, escolha o formato de cada um ou de todos de uma
// vez, e converta — a ilha pergunta a pasta onde salvar. Imagens viram PDF, juntas ou separadas.
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Mascot } from "../../components/Mascot";
import { FileAudio, FileImage, FileText, FileVideo, FileWarning, FolderOpen, Plus, X, type IconType } from "../../components/icons";
import { Button, Glyph, IconButton, Toggle } from "../../components/ui";
import { openDialog } from "../../lib/dialog";
import { inTauri, ipc } from "../../lib/ipc";
import { useT } from "../../lib/i18n";
import { formatBytes } from "../../lib/time";
import type { JobEvent } from "../../types";
import { patchSettings, useSettings } from "../settings/store";
import { FolderBar } from "./FolderBar";
import { TARGETS, toolsActions, useTools, type Pending } from "./store";

const KIND_ICON: Record<string, IconType> = { image: FileImage, video: FileVideo, audio: FileAudio, pdf: FileText, other: FileWarning };

/** Miniatura do arquivo (entra com um leve zoom quando carrega); sem ela, o ícone do tipo. */
function Thumb(props: { src?: string | null; kind: string }) {
  return (
    <span className={`vt-queue__icon is-${props.kind} ${props.src ? "has-thumb" : ""}`}>
      {props.src ? (
        <motion.img src={props.src} alt="" draggable={false} initial={{ opacity: 0, scale: 1.12 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }} />
      ) : (
        <Glyph icon={KIND_ICON[props.kind] ?? (props.kind === "other" ? FileWarning : FileVideo)} size={20} />
      )}
    </span>
  );
}

export function JobRow(props: { job: JobEvent }) {
  const t = useT();
  const { job } = props;
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} className={`vt-job is-${job.status}`}>
      <Thumb src={job.thumb} kind={job.kind === "download" ? "video" : "other"} />
      <span className="vt-job__text">
        <strong title={job.title}>{job.title}</strong>
        <span>
          {job.status === "running"
            ? job.progress === null
              ? t("tools.job.starting")
              : `${pct}%`
            : job.status === "done"
              ? t("tools.job.done")
              : job.status === "canceled"
                ? t("tools.job.canceled")
                : (job.error ?? t("tools.job.failed"))}
        </span>
        {job.status === "running" && (
          <span className="vt-job__bar">
            <motion.span initial={false} animate={{ scaleX: job.progress ?? 0.04 }} transition={{ type: "spring", visualDuration: 0.4, bounce: 0 }} className={job.progress === null ? "is-indeterminate" : ""} />
          </span>
        )}
      </span>
      {job.status === "running" ? (
        <IconButton icon={X} size="sm" variant="danger" label={t("common.cancel")} onClick={() => toolsActions.cancel(job.id)} />
      ) : (
        <span className="vt-job__actions">
          {job.status === "done" && job.output && (
            <>
              <Button size="sm" onClick={() => void ipc.filesOpen(job.output as string).catch(() => {})}>{t("tools.job.open")}</Button>
              <IconButton icon={FolderOpen} size="sm" label={t("tools.job.reveal")} onClick={() => void ipc.filesReveal(job.output as string).catch(() => {})} />
            </>
          )}
          <IconButton icon={X} size="sm" label={t("tools.job.dismiss")} onClick={() => toolsActions.dismiss(job.id)} />
        </span>
      )}
    </motion.li>
  );
}

/** Formatos oferecidos no "Todos para": a união do que os arquivos da fila aceitam. */
function commonTargets(queue: Pending[]): string[] {
  const kinds = new Set(queue.map((q) => q.kind));
  const out: string[] = [];
  for (const k of ["image", "pdf", "video", "audio"] as const) if (kinds.has(k)) for (const f of TARGETS[k]) if (!out.includes(f)) out.push(f);
  return out;
}

export function ConvertPanel(props: { dragging: boolean }) {
  const t = useT();
  const queue = useTools((s) => s.queue);
  const jobs = useTools(useShallow((s) => s.jobs.filter((j) => j.kind === "convert")));
  const error = useTools((s) => s.error);
  const folder = useSettings((s) => s.value.tools.convertFolder);
  const [merge, setMerge] = useState(true);

  const pick = async () => {
    if (!inTauri()) return;
    const picked = await openDialog({ multiple: true, directory: false, title: t("tools.cv.pickFiles") });
    const list = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    await toolsActions.addFiles(list);
  };

  const ready = queue.filter((q) => q.target && q.kind !== "other");
  const pdfImages = queue.filter((q) => q.kind === "image" && q.target === "pdf").length;
  const all = commonTargets(queue);
  const allActive = (f: string) => {
    const able = queue.filter((q) => TARGETS[q.kind].includes(f));
    return able.length > 0 && able.every((q) => q.target === f);
  };

  /** Converter: salva na pasta do rodapé (trocável ali mesmo); sem pasta, ao lado do original. */
  const convert = async () => {
    if (!inTauri() || ready.length === 0) return;
    await toolsActions.convertAll(folder, merge);
  };

  const empty = queue.length === 0 && jobs.length === 0;

  return (
    <div className={`vt-convert ${props.dragging ? "is-dragging" : ""}`}>
      {empty ? (
        <button className="vt-drop" onClick={() => void pick()}>
          <Mascot variant="head" size={78} float className="vt-drop__mascot" />
          <strong>{props.dragging ? t("tools.cv.dropNow") : t("tools.cv.dropHere")}</strong>
          <span>{t("tools.cv.dropBody")}</span>
        </button>
      ) : (
        <>
          {queue.length > 1 && all.length > 0 && (
            <div className="vt-convert__all">
              <span>{t("tools.cv.allTo")}</span>
              <span className="vt-formats" role="group" aria-label={t("tools.cv.allTo")}>
                {all.map((f) => (
                  <button key={f} className={allActive(f) ? "is-active" : ""} aria-pressed={allActive(f)} onClick={() => toolsActions.setAllTargets(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </span>
            </div>
          )}
          {queue.length > 0 && (
            <ul className="vt-queue">
              <AnimatePresence initial={false}>
                {queue.map((q) => (
                  <motion.li key={q.path} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} className="vt-queue__item">
                    <Thumb src={q.thumb} kind={q.kind} />
                    <span className="vt-queue__text">
                      <strong title={q.path}>{q.name}</strong>
                      <span>{q.kind === "other" ? t("tools.cv.unsupported") : `${q.ext.toUpperCase()} · ${formatBytes(q.size)}`}</span>
                    </span>
                    {q.kind !== "other" && (
                      <span className="vt-formats" role="radiogroup" aria-label={t("tools.cv.target", { name: q.name })}>
                        {TARGETS[q.kind].map((f) => (
                          <button key={f} role="radio" aria-checked={q.target === f} className={q.target === f ? "is-active" : ""} onClick={() => toolsActions.setTarget(q.path, f)}>
                            {f.toUpperCase()}
                          </button>
                        ))}
                      </span>
                    )}
                    <IconButton icon={X} size="sm" label={t("tools.cv.remove")} onClick={() => toolsActions.remove(q.path)} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
          {jobs.length > 0 && (
            <ul className="vt-jobs">
              <AnimatePresence initial={false}>
                {jobs.map((j) => (
                  <JobRow key={j.id} job={j} />
                ))}
              </AnimatePresence>
            </ul>
          )}
          <div className="vt-convert__bar">
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => void pick()}>{t("tools.cv.add")}</Button>
            {pdfImages > 1 && (
              <label className="vt-convert__merge">
                <Toggle label={t("tools.cv.merge")} checked={merge} onChange={setMerge} />
                <span>{merge ? t("tools.cv.mergeOn", { n: pdfImages }) : t("tools.cv.merge")}</span>
              </label>
            )}
            {jobs.some((j) => j.status !== "running") && queue.length === 0 && (
              <Button size="sm" variant="ghost" onClick={toolsActions.clearDone}>{t("tools.job.clear")}</Button>
            )}
            {queue.length > 0 && (
              <Button variant="accent" onClick={() => void convert()} disabled={ready.length === 0}>
                {t("tools.cv.convert", { n: ready.length })}
              </Button>
            )}
          </div>
        </>
      )}
      {!empty && <FolderBar value={folder} fallback={t("settings.tools.besideOriginal")} onChange={(convertFolder) => patchSettings("tools", { convertFolder })} />}
      {error && <span className="vt-inline-error">{error}</span>}
    </div>
  );
}
