// A cápsula não rouba o foco: ela só fica focável quando o usuário precisa digitar.
// Campos de texto chamam `claimKeyboard` ao serem tocados.
import { inTauri, ipc } from "../../lib/ipc";

let claimed = false;

export async function claimKeyboard(el?: HTMLElement | null) {
  if (inTauri() && !claimed) {
    claimed = true;
    await ipc.requestFocus().catch(() => {
      claimed = false;
    });
  }
  // Depois de a janela ser ativada, o foco volta ao elemento tocado.
  requestAnimationFrame(() => el?.focus());
}

export async function releaseKeyboard() {
  if (!claimed) return;
  claimed = false;
  if (inTauri()) await ipc.releaseFocus().catch(() => {});
}

export const hasKeyboard = () => claimed;

/** Props para um <input>/<textarea> dentro da cápsula. */
export const keyboardProps = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
    if (!claimed) void claimKeyboard(e.currentTarget);
  },
};
