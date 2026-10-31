import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTasks } from "./store";
import { TasksPanel } from "./TasksPanel";

describe("painel de tarefas", () => {
  beforeEach(() => {
    act(() => useTasks.getState().set({ tasks: [] }));
  });

  it("cria, conclui e exclui com confirmação", () => {
    render(<TasksPanel />);
    expect(screen.getByText("Nenhuma tarefa aberta")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Nova tarefa — Enter para adicionar");
    fireEvent.change(input, { target: { value: "Revisar relatório" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("Revisar relatório")).toBeInTheDocument();
    expect(useTasks.getState().value.tasks).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox", { name: "Concluir “Revisar relatório”" }));
    expect(useTasks.getState().value.tasks[0]?.done).toBe(true);

    // Na aba "Abertas" a concluída some; em "Todas" aparece.
    fireEvent.click(screen.getByRole("radio", { name: "Todas" }));
    expect(screen.getByText("Revisar relatório")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(screen.getByText("Excluir?")).toBeInTheDocument();
    expect(useTasks.getState().value.tasks).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Sim" }));
    expect(useTasks.getState().value.tasks).toHaveLength(0);
  });

  it("não aceita título vazio", () => {
    render(<TasksPanel />);
    const input = screen.getByPlaceholderText("Nova tarefa — Enter para adicionar");
    fireEvent.change(input, { target: { value: "    " } });
    fireEvent.submit(input.closest("form")!);
    expect(useTasks.getState().value.tasks).toHaveLength(0);
  });
});
