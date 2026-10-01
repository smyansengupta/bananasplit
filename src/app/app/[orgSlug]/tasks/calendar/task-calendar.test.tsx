import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TaskItem } from "@/components/tasks/types";

vi.mock("@/components/tasks/tasks-context", () => ({
  useTasks: () => ({ org: { id: "org_1" }, announce: vi.fn(), showTask: vi.fn() }),
}));
vi.mock("../actions", () => ({ updateTask: vi.fn() }));

const { TaskCalendar } = await import("./task-calendar");

const today = new Date();
const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;

function task(id: string, patch: Partial<TaskItem>): TaskItem {
  return {
    id,
    title: id,
    status: "IN_PROGRESS",
    visibility: "ORG",
    dueDate: null,
    parentTask: null,
    owner: null,
    ...patch,
  } as unknown as TaskItem;
}

describe("the Tasks calendar", () => {
  it("uses the main Calendar's month table and chips, coloured by status", () => {
    const html = renderToStaticMarkup(
      <TaskCalendar
        tasks={[
          task("Book the room", { dueDate: new Date(`${key}T00:00:00Z`), status: "BLOCKED" }),
          task("Order pizza", {}),
        ]}
      />,
    );
    expect(html).toContain('class="cal-table"');
    expect(html).not.toContain("fc-");
    expect(html).toContain("Book the room");
    expect(html).toContain("--kind:var(--destructive)");
    expect(html).toContain("1 task due this month");
    // The undated task waits in the tray, draggable.
    expect(html).toContain("No due date");
    expect(html).toMatch(/draggable="true"[^>]*>[\s\S]*Order pizza/);
  });
});
