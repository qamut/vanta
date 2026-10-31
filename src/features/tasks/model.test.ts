import { describe, expect, it } from "vitest";
import { createTask, filterTasks, isOverdue, removeTask, sanitizeTasks, sortTasks, toggleDone, todayProgress, updateTask, type Task } from "./model";

const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
const mk = (id: string, title: string, opts: Partial<Task> = {}, now = day(25)): Task => ({ ...createTask(id, title, now)!, ...opts });

describe("tarefas", () => {
  it("normaliza títulos e recusa vazios", () => {
    expect(createTask("a", "   ", 0)).toBeNull();
    expect(createTask("a", "  Revisar \n relatório  ", 0)?.title).toBe("Revisar relatório");
    expect(createTask("a", "x".repeat(500), 0)?.title).toHaveLength(200);
  });

  it("edita, conclui, reabre e remove", () => {
    let s = { tasks: [mk("a", "A")] };
    s = updateTask(s, "a", { title: "B", priority: "high" }, 5);
    expect(s.tasks[0]).toMatchObject({ title: "B", priority: "high", updatedAt: 5 });
    expect(updateTask(s, "a", { title: "   " }, 6).tasks[0]?.title).toBe("B");
    s = toggleDone(s, "a", 7);
    expect(s.tasks[0]).toMatchObject({ done: true, doneAt: 7 });
    s = toggleDone(s, "a", 8);
    expect(s.tasks[0]).toMatchObject({ done: false, doneAt: null });
    expect(removeTask(s, "a").tasks).toHaveLength(0);
  });

  it("ordena por prioridade e prazo, com concluídas no fim", () => {
    const tasks = [
      mk("low", "low", { priority: "low" }),
      mk("done", "done", { priority: "high", done: true, doneAt: 1 }),
      mk("high-late", "h2", { priority: "high", due: day(27) }),
      mk("high-soon", "h1", { priority: "high", due: day(26) }),
    ];
    expect(sortTasks(tasks, "priority").map((t) => t.id)).toEqual(["high-soon", "high-late", "low", "done"]);
    expect(sortTasks(tasks, "due").map((t) => t.id)).toEqual(["high-soon", "high-late", "low", "done"]);
    expect(filterTasks(tasks, "done").map((t) => t.id)).toEqual(["done"]);
    expect(filterTasks(tasks, "open")).toHaveLength(3);
  });

  it("calcula o progresso do dia e atrasos", () => {
    const now = day(25, 18);
    const tasks = [
      mk("today-done", "a", { done: true, doneAt: day(25, 10) }, day(20)),
      mk("today-open", "b", {}, day(25, 9)),
      mk("overdue", "c", { due: day(23) }, day(20)),
      mk("old-done", "d", { done: true, doneAt: day(20) }, day(19)),
      mk("future", "e", { due: day(30) }, day(19)),
    ];
    expect(todayProgress(tasks, now)).toEqual({ done: 1, total: 3 });
    expect(isOverdue(tasks[2]!, now)).toBe(true);
    expect(isOverdue(tasks[4]!, now)).toBe(false);
  });

  it("sanitiza dados persistidos inválidos", () => {
    const s = sanitizeTasks({
      tasks: [
        { id: "ok", title: "x", priority: "urgent", due: "amanhã" },
        { id: "ok", title: "duplicada" },
        { title: "sem id" },
        { id: "vazia", title: "   " },
        null,
      ],
    });
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ id: "ok", priority: "medium", due: null, done: false });
    expect(sanitizeTasks("lixo").tasks).toEqual([]);
  });
});
