import { inTauri, ipc, on } from "../../lib/ipc";
import { tr } from "../../lib/i18n";
import { createPersisted, uid } from "../../lib/persisted";
import { pushNotice } from "../notifications/store";
import { useSettings } from "../settings/store";
import { createTask, initialTasks, MAX_TASKS, removeTask, sanitizeTasks, toggleDone, updateTask, type Task, type TasksState } from "./model";

export const useTasks = createPersisted<TasksState>("tasks", initialTasks, sanitizeTasks);

/** Reagenda os alarmes de tarefas: lembrete explícito e o próprio prazo. */
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function syncAlarms() {
  if (!inTauri()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const now = Date.now();
    const notify = useSettings.getState().value.notifications.tasks;
    try {
      await ipc.alarmCancel("task:", true);
      const upcoming = useTasks
        .getState()
        .value.tasks.filter((t) => !t.done)
        .flatMap((t) => {
          const out: { id: string; at: number; task: Task; kind: "remind" | "due" }[] = [];
          if (t.remindAt && t.remindAt > now) out.push({ id: `task:r:${t.id}`, at: t.remindAt, task: t, kind: "remind" });
          if (t.due && t.due > now && t.due !== t.remindAt) out.push({ id: `task:d:${t.id}`, at: t.due, task: t, kind: "due" });
          return out;
        })
        .sort((a, b) => a.at - b.at)
        .slice(0, 100);
      for (const a of upcoming) {
        await ipc.alarmSet({
          id: a.id.slice(0, 80),
          atMs: a.at,
          title: a.kind === "due" ? tr("tasks.notify.dueTitle") : tr("tasks.notify.remindTitle"),
          body: a.task.title.slice(0, 280),
          category: "tasks",
          notify,
        });
      }
    } catch {
      /* conveniência */
    }
  }, 300);
}

function commit(updater: (s: TasksState) => TasksState) {
  useTasks.getState().set(updater);
  syncAlarms();
}

export const taskActions = {
  add: (title: string, opts: Partial<Pick<Task, "priority" | "due" | "remindAt">> = {}): boolean => {
    const task = createTask(uid(), title, Date.now(), opts);
    if (!task || useTasks.getState().value.tasks.length >= MAX_TASKS) return false;
    commit((s) => ({ tasks: [...s.tasks, task] }));
    return true;
  },
  update: (id: string, patch: Partial<Omit<Task, "id" | "createdAt">>) => commit((s) => updateTask(s, id, patch, Date.now())),
  toggle: (id: string) => commit((s) => toggleDone(s, id, Date.now())),
  remove: (id: string) => commit((s) => removeTask(s, id)),
  clearDone: () => commit((s) => ({ tasks: s.tasks.filter((t) => !t.done) })),
};

let wired = false;
export function wireTasks() {
  if (wired) return;
  wired = true;
  if (useTasks.getState().loaded) syncAlarms();
  else {
    const unsub = useTasks.subscribe((s) => {
      if (s.loaded) {
        unsub();
        syncAlarms();
      }
    });
  }
  void on("alarm://fired", (p) => {
    if (p.category !== "tasks" || p.lateMs > 15 * 60_000) return;
    const id = p.id.replace(/^task:[rd]:/, "");
    const task = useTasks.getState().value.tasks.find((t) => t.id === id);
    if (!task || task.done) return;
    const due = p.id.startsWith("task:d:");
    pushNotice(
      { category: "tasks", title: due ? tr("tasks.notify.dueTitle") : tr("tasks.notify.remindTitle"), body: task.title },
      { module: "tasks" },
    );
  });
  let prev = useSettings.getState().value.notifications.tasks;
  useSettings.subscribe((s) => {
    if (s.value.notifications.tasks !== prev) {
      prev = s.value.notifications.tasks;
      syncAlarms();
    }
  });
}
