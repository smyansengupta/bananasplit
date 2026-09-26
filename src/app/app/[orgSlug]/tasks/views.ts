import { TaskStatus, TaskVisibility } from "@/generated/prisma/enums";

/**
 * The task workspace's URL grammar (C4).
 *
 * There used to be seven tabs — My Tasks, Board, Table, Calendar, Team,
 * Sunday update, Requests — sitting next to each other as if they were the
 * same kind of thing. They were not. Five of them draw the SAME set of tasks
 * in different shapes; the other two are pieces of work you do (compose the
 * week's update, run the request queue).
 *
 * So the workspace is now one filtered question asked five ways:
 *
 *   LAYOUT  week · board · table · calendar · team   (how it is drawn)
 *   SCOPE   mine · team · all                        (whose work)
 *   FILTERS project, status, label, search, due range, flagged, blockers,
 *           visibility                               (which tasks)
 *
 * One toolbar drives all of it and every layout reads the same filters, so
 * switching from the board to the table never silently changes what you are
 * looking at. Requests and the Sunday update moved out of the row of tabs
 * and became their own destinations in the header.
 *
 * `?view=` keeps its old name and every old value, so the links other
 * sections already publish keep working exactly as documented:
 *
 *   ?view=table&owner={id}&status=open   that person's open tasks
 *   ?view=table&assignee={id}            tasks involving that person
 *   ?view=mine                           now the Week layout, scope mine
 *   ?view=board | calendar | team | updates | intake
 */

export const TASK_LAYOUTS = [
  { value: "week", label: "Week", hint: "What is due, by when" },
  { value: "board", label: "Board", hint: "Move work along" },
  { value: "table", label: "Table", hint: "Filter and bulk-edit" },
  { value: "calendar", label: "Calendar", hint: "Due dates on a month" },
  { value: "team", label: "Team", hint: "A lane per person" },
] as const;

export type TaskLayout = (typeof TASK_LAYOUTS)[number]["value"];

/** Not layouts: the two things you go and DO. */
export const TASK_DESTINATIONS = ["updates", "intake"] as const;
export type TaskDestination = (typeof TASK_DESTINATIONS)[number];

export type TaskView = TaskLayout | TaskDestination;

export const TASK_SCOPES = [
  { value: "mine", label: "Mine" },
  { value: "team", label: "My team" },
  { value: "all", label: "Everyone" },
] as const;

export type TaskScope = (typeof TASK_SCOPES)[number]["value"];

export const TASKS_VIEW_COOKIE = "cbc-tasks-view";

/**
 * The week is the first-visit default: a club board opens this page to find
 * out what it owes, not to look at a kanban.
 */
export const DEFAULT_TASK_LAYOUT: TaskLayout = "week";

export function isLayout(value: unknown): value is TaskLayout {
  return TASK_LAYOUTS.some((l) => l.value === value);
}

export function isDestination(value: unknown): value is TaskDestination {
  return TASK_DESTINATIONS.includes(value as TaskDestination);
}

/** `view=mine` is the old name for "the week, just my work". */
export function parseTaskView(value: unknown): TaskView | null {
  if (value === "mine") return "week";
  if (isLayout(value) || isDestination(value)) return value;
  return null;
}

export function parseScope(value: unknown): TaskScope | null {
  return TASK_SCOPES.some((s) => s.value === value) ? (value as TaskScope) : null;
}

/** The filters the toolbar owns, as they appear in the URL. */
export interface WorkspaceQuery {
  view: TaskView;
  scope: TaskScope;
  projectId?: string;
  status?: TaskStatus | "open";
  ownerId?: string;
  assigneeId?: string;
  labelId?: string;
  q?: string;
  dueFrom?: string;
  dueTo?: string;
  flagged: boolean;
  blockers: boolean;
  visibility?: TaskVisibility;
}

function str(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type Query = Record<string, string | string[] | undefined>;

export function parseWorkspaceQuery(
  query: Query,
  rememberedView: string | undefined,
): WorkspaceQuery {
  const raw = str(query.view);
  const view = parseTaskView(raw) ?? parseTaskView(rememberedView) ?? DEFAULT_TASK_LAYOUT;
  const ownerId = str(query.owner);
  const assigneeId = str(query.assignee);
  const statusParam = str(query.status);
  const status =
    statusParam === "open"
      ? ("open" as const)
      : statusParam && (Object.values(TaskStatus) as string[]).includes(statusParam)
        ? (statusParam as TaskStatus)
        : undefined;
  const visibilityParam = str(query.visibility)?.toUpperCase();
  const visibility = (Object.values(TaskVisibility) as string[]).includes(visibilityParam ?? "")
    ? (visibilityParam as TaskVisibility)
    : undefined;

  // The week is personal by default; every other layout opens on the whole
  // club. An explicit ?owner= or ?assignee= (the deep links other sections
  // publish) also means "this person", so the scope steps out of the way.
  const defaultScope: TaskScope =
    raw === "mine" ? "mine" : ownerId || assigneeId ? "all" : view === "week" ? "mine" : "all";
  const scope = raw === "mine" ? "mine" : (parseScope(str(query.scope)) ?? defaultScope);

  return {
    view,
    scope,
    projectId: str(query.project),
    status,
    ownerId,
    assigneeId,
    labelId: str(query.label),
    q: str(query.q)?.slice(0, 200),
    dueFrom: str(query.dueFrom),
    dueTo: str(query.dueTo),
    flagged: str(query.flagged) === "1",
    blockers: str(query.blockers) === "1",
    visibility,
  };
}

/** How many toolbar filters (beyond the scope and the project) are on. */
export function activeFilterCount(q: WorkspaceQuery): number {
  return [
    q.status,
    q.ownerId,
    q.assigneeId,
    q.labelId,
    q.q,
    q.dueFrom,
    q.dueTo,
    q.flagged || undefined,
    q.blockers || undefined,
    q.visibility,
  ].filter(Boolean).length;
}

/** Builds `?...` from a workspace query, dropping everything at its default. */
export function workspaceHref(
  q: Partial<WorkspaceQuery> & { view: TaskView },
  extra?: Query,
): string {
  const p = new URLSearchParams();
  p.set("view", q.view);
  if (q.scope && q.scope !== "all") p.set("scope", q.scope);
  if (q.projectId) p.set("project", q.projectId);
  if (q.status) p.set("status", q.status);
  if (q.ownerId) p.set("owner", q.ownerId);
  if (q.assigneeId) p.set("assignee", q.assigneeId);
  if (q.labelId) p.set("label", q.labelId);
  if (q.q) p.set("q", q.q);
  if (q.dueFrom) p.set("dueFrom", q.dueFrom);
  if (q.dueTo) p.set("dueTo", q.dueTo);
  if (q.flagged) p.set("flagged", "1");
  if (q.blockers) p.set("blockers", "1");
  if (q.visibility) p.set("visibility", q.visibility);
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (typeof v === "string" && v.length > 0) p.set(k, v);
  }
  return `?${p.toString()}`;
}
