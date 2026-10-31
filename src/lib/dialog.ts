// Diálogos nativos (escolher pasta/arquivos) por cima da ilha. Enquanto um deles está na tela, o
// cursor sai da ilha, o clique dentro do diálogo conta como "clique fora" e a janela perde o foco
// — três caminhos que recolheriam a ilha no meio da escolha. A trava abaixo segura a ilha aberta.
import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

let open_ = 0;

/** Há um diálogo nativo aberto (ou acabou de fechar)? */
export const isDialogOpen = () => open_ > 0;

/** `open` do plugin, com a ilha travada aberta até o diálogo fechar. */
export async function openDialog<T extends OpenDialogOptions>(options: T) {
  open_++;
  try {
    return await open(options);
  } finally {
    // folga: o clique que fecha o diálogo e o cursor voltando não podem recolher a ilha
    setTimeout(() => {
      open_ = Math.max(0, open_ - 1);
    }, 600);
  }
}
