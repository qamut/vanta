// Tarefas: criação, edição, filtros, ordenação e progresso do dia.
import { bool, isObj, num, oneOf, str } from "../../lib/persisted";
import { DAY, startOfDay } from "../../lib/time";

export type Priority = "low" | "medium" | "high";
export type TaskFilter = "open" | "done" | "all";
export type TaskSort = "priority" | "due" | "created";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  doneAt: number | null;
  priority: Priority;
  due: number | null;
  remindAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TasksState {
  tasks: Task[];
}

export const MAX_TASKS = 500;
export const MAX_TITLE = 200;

export const initialTasks = (): TasksState => ({ tasks: [] });

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

export function createTask(
  id: string,
  title: string,
  now: number,
  opts: Partial<Pick<Task, "priority" | "due" | "remindAt">> = {},
): Task | null {
  const t = cleanTitle(title);
  if (!t) return null;
  return {
    id,
    title: t,
    done: false,
    doneAt: null,
    priority: opts.priority ?? "medium",
    due: opts.due ?? null,
    remindAt: opts.remindAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTask(s: TasksState, id: string, patch: Partial<Omit<Task, "id" | "createdAt">>, now: number): TasksState {
  return {
    tasks: s.tasks.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, ...patch, updatedAt: now };
      if (patch.title !== undefined) {
        const title = cleanTitle(patch.title);
        if (!title) return t;
        next.title = title;
      }
      return next;
    }),
  };
}

export function toggleDone(s: TasksState, id: string, now: number): TasksState {
  return {
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : now, updatedAt: now } : t)),
  };
}

export function removeTask(s: TasksState, id: string): TasksState {
  return { tasks: s.tasks.filter((t) => t.id !== id) };
}

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  if (filter === "open") return tasks.filter((t) => !t.done);
  if (filter === "done") return tasks.filter((t) => t.done);
  return tasks;
}

export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const byDue = (a: Task, b: Task) => (a.due ?? Infinity) - (b.due ?? Infinity);
  const byPriority = (a: Task, b: Task) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const byCreated = (a: Task, b: Task) => b.createdAt - a.createdAt;
  const cmp = sort === "priority" ? [byPriority, byDue, byCreated] : sort === "due" ? [byDue, byPriority, byCreated] : [byCreated];
  // Concluídas sempre vão para o fim.
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    for (const c of cmp) {
      const r = c(a, b);
      if (r !== 0 && Number.isFinite(r)) return r;
    }
    return 0;
  });
}

/** Progresso do dia: tarefas "de hoje" (criadas, vencendo ou concluídas hoje) e quantas estão feitas. */
export function todayProgress(tasks: Task[], now: number): { done: number; total: number } {
  const from = startOfDay(now);
  const to = from + DAY;
  const inToday = (ts: number | null) => ts !== null && ts >= from && ts < to;
  const today = tasks.filter((t) => inToday(t.createdAt) || inToday(t.due) || inToday(t.doneAt) || (!t.done && t.due !== null && t.due < from));
  return { done: today.filter((t) => t.done).length, total: today.length };
}

export function isOverdue(t: Task, now: number): boolean {
  return !t.done && t.due !== null && t.due < now;
}

export function sanitizeTasks(raw: unknown): TasksState {
  const list = isObj(raw) && Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks: Task[] = [];
  const seen = new Set<string>();
  for (const r of list.slice(0, MAX_TASKS)) {
    if (!isObj(r) || typeof r.id !== "string" || seen.has(r.id)) continue;
    const title = cleanTitle(str(r.title, "", MAX_TITLE));
    if (!title) continue;
    seen.add(r.id);
    const ts = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    tasks.push({
      id: r.id.slice(0, 64),
      title,
      done: bool(r.done, false),
      doneAt: ts(r.doneAt),
      priority: oneOf(r.priority, ["low", "medium", "high"] as const, "medium"),
      due: ts(r.due),
      remindAt: ts(r.remindAt),
      createdAt: num(r.createdAt, Date.now(), 0, 8.64e15),
      updatedAt: num(r.updatedAt, Date.now(), 0, 8.64e15),
    });
  }
  return { tasks };
}
