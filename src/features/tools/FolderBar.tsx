// Rodapé das ferramentas: mostra para onde vão os arquivos e deixa trocar a pasta ali mesmo,
// sem abrir as Configurações. A escolha é a mesma de Configurações → Ferramentas.
import { FolderOpen } from "../../components/icons";
import { Button, IconButton } from "../../components/ui";
import { openDialog } from "../../lib/dialog";
import { inTauri, ipc } from "../../lib/ipc";
import { useT } from "../../lib/i18n";

export function FolderBar(props: {
  /** Pasta escolhida pelo usuário (null = padrão). */
  value: string | null;
  /** Caminho real em uso, quando conhecido (para abrir no Explorer). */
  resolved?: string | null;
  /** Texto do padrão quando não há pasta escolhida ("Downloads\VANTA", "A do primeiro arquivo"). */
  fallback: string;
  onChange: (folder: string | null) => void;
}) {
  const t = useT();
  const shown = props.value ?? props.resolved ?? props.fallback;
  const pick = async () => {
    if (!inTauri()) return;
    const dir = await openDialog({ directory: true, multiple: false, title: t("tools.folder.pick"), defaultPath: props.value ?? props.resolved ?? undefined });
    if (typeof dir === "string") props.onChange(dir);
  };
  const openable = props.value ?? props.resolved;
  return (
    <div className="vt-folderbar">
      <span className="vt-folderbar__path" title={shown}>
        {t("tools.folder.saveTo")} <b>{shown}</b>
      </span>
      {openable && <IconButton icon={FolderOpen} size="sm" label={t("tools.job.reveal")} onClick={() => void ipc.filesOpen(openable).catch(() => {})} />}
      <Button size="sm" variant="ghost" onClick={() => void pick()}>{t("tools.folder.change")}</Button>
      {props.value && (
        <Button size="sm" variant="ghost" onClick={() => props.onChange(null)}>{t("settings.tools.reset")}</Button>
      )}
    </div>
  );
}
