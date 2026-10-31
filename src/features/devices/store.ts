// Energia e áudio: estado vindo dos eventos nativos + alertas de transição na cápsula.
import { create } from "zustand";
import { inTauri, ipc, on } from "../../lib/ipc";
import { tr } from "../../lib/i18n";
import type { AudioState, PowerState } from "../../types";
import { useAlerts } from "../notifications/store";

interface Devices {
  power: PowerState | null;
  audio: AudioState | null;
}

export const useDevices = create<Devices>(() => ({ power: null, audio: null }));

export const isPersonalAudio = (form: string | undefined) => form === "headphones" || form === "headset";

let wired = false;
export function wireDevices(withAlerts: boolean) {
  if (wired || !inTauri()) return;
  wired = true;
  void ipc.powerState().then((power) => useDevices.setState({ power }));
  void ipc.audioState().then((audio) => useDevices.setState({ audio }));

  void on("power://state", (next) => {
    const prev = useDevices.getState().power;
    useDevices.setState({ power: next });
    if (!withAlerts || !prev || !next.hasBattery) return;
    if (prev.plugged !== next.plugged) {
      useAlerts.getState().show({
        kind: "power",
        icon: next.plugged ? "charging" : "battery",
        title: next.plugged ? tr("power.alert.plugged") : tr("power.alert.unplugged"),
        detail: next.plugged ? tr("power.alert.pluggedDetail") : tr("power.alert.onBattery"),
        value: next.percent !== null ? `${next.percent}%` : undefined,
        tone: next.plugged ? "success" : "accent",
        module: "power",
      });
    }
  });

  void on("audio://state", (next) => {
    const prev = useDevices.getState().audio;
    useDevices.setState({ audio: next });
    const before = prev?.defaultOutput?.id;
    const after = next.defaultOutput;
    if (!withAlerts || !prev || !after || before === after.id) return;
    useAlerts.getState().show({
      kind: "audio",
      icon: after.bus === "bluetooth" ? "bluetooth" : isPersonalAudio(after.form) ? "headphones" : "speaker",
      title: after.name,
      detail: tr("audio.alert.nowPlayingHere"),
      tone: "accent",
      module: "audio",
    });
  });
}
