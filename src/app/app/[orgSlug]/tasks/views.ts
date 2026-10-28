import { TaskStatus, TaskVisibility } from "@/generated/prisma/enums";

/**
 * The task workspace's URL grammar (C4).
 *
 * There used to be seven tabs — My Tasks, Board, Table, Calendar, Team,
 * the weekly update, Requests — sitting next to each other as if they were the
 * same kind of thing. They were not. Five of them draw the SAME set of tasks
 * in different shapes; the other two are pieces of work you do (compose the
 * week's update, run the request queue).
 *
 * So the workspace is now one filtered question asked four ways:
 *
 *   LAYOUT  board · list · table · roadmap · dashboard   (how it is drawn)
 *   SCOPE   mine · team · all                        (whose work)
 *   FILTERS project, status, label, search, due range, flagged, blockers,
 *           visibility                               (which tasks)
 *
 * One toolbar drives all of it and every layout reads the same filters, so
 * switching from the board to the table never silently changes what you are
 * looking at. The dashboard is the same question again, counted: where the
 * work in view stands, by project and by person. The weekly update is a
 * destination of its own (reached from the Week and the dashboard), and the
 * request queue is gone.
 *
 * The board is the default. The calendar layout became the main calendar's
 * Tasks layer (due dates beside the events, one calendar for everything),
 * and the team layout is gone: ?view=calendar now opens the Calendar, and
 * ?view=team the board.
 *
 * `?view=` keeps its old name and every old value, so the links other
 * sections already publish keep working exactly as documented:
 *
 *   ?view=table&owner={id}&status=open   that person's open tasks
 *   ?view=table&assignee={id}            tasks involving that person
 *   ?view=mine | week                    now the List, scope mine
 *   ?view=board | list | table | roadmap | dashboard | updates
 *   ?view=intake                         the board (Requests is retired)
 *   ?view=calendar                       the Calendar, tasks shown
 *   ?view=team                           the board
 */

/** In the switcher's order: where things stand first, then the board it opens on. */
export const TASK_LAYOUTS = [
  { value: "dashboard", label: "Dashboard", hint: "Where things stand" },
  { value: "board", label: "Board", hint: "Move work along" },
  { value: "list", label: "List", hint: "Grouped by epic" },
  { value: "table", label: "Table", hint: "Filter and bulk-edit" },
  { value: "roadmap", label: "Epics", hint: "The big pieces, and where they stand" },
] as const;

export type TaskLayout = (typeof TASK_LAYOUTS)[number]["value"];

/**
 * The layouts a phone leaves out: the board's columns and the table's
 * columns don't fit one. A phone asking for one gets the List.
 */
export const PHONE_HIDDEN_LAYOUTS: readonly TaskLayout[] = ["board", "table"];

/** Not a layout: the weekly update is a piece of work you go and do. */
export const TASK_DESTINATIONS = ["updates"] as const;
export type TaskDestination = (typeof TASK_DESTINATIONS)[number];

/**
 * The Free plan's one view: a plain list of the club's tasks. Not a layout
 * you pick (the page sets it when the plan has no other views; see
 * src/lib/billing/features.ts), so it is not in TASK_LAYOUTS.
 */
export const TASK_LIST_VIEW = "list";

export type TaskView = TaskLayout | TaskDestination | typeof TASK_LIST_VIEW;

export const TASK_SCOPES = [
  { value: "mine", label: "Mine" },
  { value: "team", label: "My team" },
  { value: "all", label: "Everyone" },
] as const;

export type TaskScope = (typeof TASK_SCOPES)[number]["value"];

/**
 * Tasks always opens on the board (the club's work, moving along), whatever
 * layout was last picked: only an explicit ?view= opens another.
 */
export const DEFAULT_TASK_LAYOUT: TaskLayout = "board";

export function isLayout(value: unknown): value is TaskLayout {
  return TASK_LAYOUTS.some((l) => l.value === value);
}

export function isDestination(value: unknown): value is TaskDestination {
  return TASK_DESTINATIONS.includes(value as TaskDestination);
}

/**
 * `view=mine` and `view=week` are the old names for "what is due, just my
 * work"; the Week layout is gone and the List, scoped to you, is what it was
 * for. The retired team layout, the retired request queue (?view=intake) and
 * the old calendar one open the board. A requested ?view=calendar is sent to
 * the Calendar by the page before this runs.
 */
export function parseTaskView(value: unknown): TaskView | null {
  if (value === "mine" || value === "week") return "list";
  if (value === "team" || value === "calendar" || value === "intake") return "board";
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
  /** One epic's work (?epic=; the old ?project= links land here too: a project's epic kept its id). */
  epicId?: string;
  status?: TaskStatus | "open";
  ownerId?: string;
  assigneeId?: string;
  labelId?: string;
  q?: string;
  dueFrom?: string;
  dueTo?: string;
  flagged: boolean;
  /** Open and due before today (?overdue=1), from the Overdue stat. */
  overdue: boolean;
  blockers: boolean;
  visibility?: TaskVisibility;
}

function str(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type Query = Record<string, string | string[] | undefined>;

export function parseWorkspaceQuery(
  query: Query,
): WorkspaceQuery {
  const raw = str(query.view);
  const view = parseTaskView(raw) ?? DEFAULT_TASK_LAYOUT;
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
  // The old week links were personal by default, so they stay personal.
  const personal = raw === "mine" || raw === "week";
  const defaultScope: TaskScope = personal ? "mine" : ownerId || assigneeId ? "all" : "all";
  const scope = personal ? "mine" : (parseScope(str(query.scope)) ?? defaultScope);

  return {
    view,
    scope,
    epicId: str(query.epic) ?? str(query.project),
    status,
    ownerId,
    assigneeId,
    labelId: str(query.label),
    q: str(query.q)?.slice(0, 200),
    dueFrom: str(query.dueFrom),
    dueTo: str(query.dueTo),
    flagged: str(query.flagged) === "1",
    overdue: str(query.overdue) === "1",
    blockers: str(query.blockers) === "1",
    visibility,
  };
}

/** How many toolbar filters (beyond the scope and the epic) are on. */
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
    q.overdue || undefined,
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
  if (q.epicId) p.set("epic", q.epicId);
  if (q.status) p.set("status", q.status);
  if (q.ownerId) p.set("owner", q.ownerId);
  if (q.assigneeId) p.set("assignee", q.assigneeId);
  if (q.labelId) p.set("label", q.labelId);
  if (q.q) p.set("q", q.q);
  if (q.dueFrom) p.set("dueFrom", q.dueFrom);
  if (q.dueTo) p.set("dueTo", q.dueTo);
  if (q.flagged) p.set("flagged", "1");
  if (q.overdue) p.set("overdue", "1");
  if (q.blockers) p.set("blockers", "1");
  if (q.visibility) p.set("visibility", q.visibility);
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (typeof v === "string" && v.length > 0) p.set(k, v);
  }
  return `?${p.toString()}`;
}
