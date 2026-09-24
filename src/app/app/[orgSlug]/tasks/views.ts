/** The task views (?view=...) and the cookie that remembers each person's last one. */

export const TASK_VIEWS = [
  { value: "mine", label: "My Tasks" },
  { value: "board", label: "Board" },
  { value: "table", label: "Table" },
  { value: "calendar", label: "Calendar" },
  { value: "team", label: "Team" },
  { value: "updates", label: "Sunday update" },
  { value: "intake", label: "Requests" },
] as const;

export type TaskView = (typeof TASK_VIEWS)[number]["value"];

export const TASKS_VIEW_COOKIE = "cbc-tasks-view";

/** The board is the first-visit default; after that, whatever the person picked last. */
export const DEFAULT_TASK_VIEW: TaskView = "board";

export function parseTaskView(value: unknown): TaskView | null {
  return typeof value === "string" && TASK_VIEWS.some((v) => v.value === value) ? (value as TaskView) : null;
}
