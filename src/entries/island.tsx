import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/base.css";
import "../styles/island.css";
import "../styles/settings-panel.css";
import { wireDevices } from "../features/devices/store";
import { Island } from "../features/island/Island";
import { wireMedia } from "../features/media/store";
import { wireTasks } from "../features/tasks/store";
import { wireTools } from "../features/tools/store";
import { wireWater } from "../features/water/store";

// A cápsula é a dona dos agendamentos: só ela liga Pomodoro, água e tarefas aos alarmes.
wireMedia();
wireDevices(true);
wireWater();
wireTasks();
wireTools();

// Menu de contexto do navegador não faz sentido numa cápsula do sistema.
window.addEventListener("contextmenu", (e) => e.preventDefault());

const root = document.getElementById("root");
if (!root) throw new Error("#root ausente");
createRoot(root).render(
  <StrictMode>
    <Island />
  </StrictMode>,
);
