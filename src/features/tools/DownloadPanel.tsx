// Downloader: cole (ou copie) um link de vídeo e baixe em MP4 ou só o áudio em MP3.
import { AnimatePresence } from "motion/react";
import { useEffect, type FormEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Mascot } from "../../components/Mascot";
import { Upload } from "../../components/icons";
import { Button, Segmented } from "../../components/ui";
import { inTauri } from "../../lib/ipc";
import { useT } from "../../lib/i18n";
import { keyboardProps } from "../island/focus";
import { patchSettings, useSettings } from "../settings/store";
import { JobRow } from "./ConvertPanel";
import { FolderBar } from "./FolderBar";
import { isImageLink, toolsActions, useTools } from "./store";

export function DownloadPanel() {
  const t = useT();
  const url = useTools((s) => s.url);
  const status = useTools((s) => s.downloader);
  const installing = useTools((s) => s.installing || !!s.downloader?.installing);
  const error = useTools((s) => s.error);
  const jobs = useTools(useShallow((s) => s.jobs.filter((j) => j.kind === "download")));
  const mode = useSettings((s) => s.value.tools.downloadMode);
  const imageMode = useSettings((s) => s.value.tools.imageMode);
  const pin = isImageLink(url);
  const folder = useSettings((s) => s.value.tools.downloadFolder);

  useEffect(() => {
    void toolsActions.refreshDownloader();
  }, []);

  if (inTauri() && status && !status.installed) {
    return (
      <div className="vt-dl-setup">
        <Mascot variant="full" size={96} float />
        <div className="vt-dl-setup__text">
          <strong>{t("tools.dl.setupTitle")}</strong>
          <span>{t("tools.dl.setupBody")}</span>
          <Button variant="accent" onClick={() => void toolsActions.installDownloader()} disabled={installing}>
            {installing ? t("tools.dl.installing") : t("tools.dl.install")}
          </Button>
          {error && <span className="vt-inline-error">{error}</span>}
        </div>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) void toolsActions.download();
  };

  return (
    <div className="vt-dl">
      <form className="vt-dl__form" onSubmit={submit}>
        <input
          className="vt-input vt-dl__input"
          value={url}
          placeholder={t("tools.dl.placeholder")}
          aria-label={t("tools.dl.placeholder")}
          onChange={(e) => toolsActions.setUrl(e.target.value)}
          spellCheck={false}
          {...keyboardProps}
        />
        {/* link do Pinterest: as opções viram formatos de imagem */}
        {pin ? (
          <Segmented
            size="sm"
            label={t("tools.dl.mode")}
            value={imageMode}
            onChange={(imageMode) => patchSettings("tools", { imageMode })}
            options={[
              { value: "jpg", label: t("tools.dl.jpg") },
              { value: "png", label: t("tools.dl.png") },
            ]}
          />
        ) : (
          <Segmented
            size="sm"
            label={t("tools.dl.mode")}
            value={mode}
            onChange={(downloadMode) => patchSettings("tools", { downloadMode })}
            options={[
              { value: "video", label: t("tools.dl.video") },
              { value: "audio", label: t("tools.dl.audio") },
            ]}
          />
        )}
        <Button variant="accent" type="submit" icon={Upload} disabled={!url.trim()}>
          {t("tools.dl.go")}
        </Button>
      </form>
      {jobs.length === 0 ? (
        <div className="vt-dl__hint">
          <Mascot variant="head" size={60} float />
        </div>
      ) : (
        <ul className="vt-jobs">
          <AnimatePresence initial={false}>
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      <FolderBar
        value={folder}
        resolved={status?.folder}
        fallback={t("settings.tools.defaultDownloads")}
        onChange={(downloadFolder) => {
          patchSettings("tools", { downloadFolder });
          void toolsActions.refreshDownloader();
        }}
      />
      {error && <span className="vt-inline-error">{error}</span>}
    </div>
  );
}
