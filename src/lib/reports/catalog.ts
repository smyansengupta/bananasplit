import { z } from "zod";

import { BOARD_COLUMNS, MAX_ROWS, MAX_WIDGETS, fillRows, type WidgetMeta } from "@/lib/boards";

export { fillRows };
import type { Choice, FieldType } from "@/lib/databases/fields";

/**
 * Saved reports' widgets (Databases > Reports): what each one shows, the
 * settings it takes, and when the New report walkthrough ticks it for a
 * database. Pure and client-safe: the walkthrough suggests with it and the
 * server validates every save with it.
 *
 * Every widget reads ONE source, the report's, through the same shape
 * (ReportField, ReportRow): a club-made database's own fields, or the built-in
 * Tasks and Expenses written as fields. People and Events have their own
 * widgets, which read the built-in reports.
 */

// ---- Sources ----------------------------------------------------------------

export type SourceKind = "custom" | "tasks" | "expenses" | "events" | "people";

/** A field a widget can read. Choice fields keep their order (a pipeline's stages). */
export interface ReportField {
  id: string;
  name: string;
  type: FieldType;
  choices?: Choice[];
  /** Choices that mean finished (Done, Returned, Paid): left out of Overdue and stale. */
  done?: string[];
  /** The choices a pipeline walks, in order, when not all of them are steps (Rejected isn't). */
  stages?: string[];
}

/** When a row was added: every source has it, so it's offered as a date field. */
export const CREATED = "@created";

export interface SourceSummary {
  key: string;
  kind: SourceKind;
  name: string;
  /** Icon name (@/components/icons). */
  icon: string;
  description: string;
  /** Where its rows are. */
  href: string;
  fields: ReportField[];
  rows: number;
  /** A form fills it (Form results). */
  form: { title: string; href: string } | null;
}

const SOURCE_KEY = /^(custom:[A-Za-z0-9_-]{1,40}|tasks|expenses|events|people)$/;
export const sourceKeySchema = z.string().regex(SOURCE_KEY);

export function sourceKind(key: string): SourceKind {
  return key.startsWith("custom:") ? "custom" : (key as SourceKind);
}

// ---- Widgets ----------------------------------------------------------------

export const WIDGET_TYPES = [
  "insights",
  "number",
  "over-time",
  "breakdown",
  "pipeline",
  "top-values",
  "goal",
  "compare",
  "calendar",
  "overdue",
  "table",
  "spread",
  "health",
  "form-results",
  "people",
  "attendance",
  "rsvps",
  "retention",
  "journey",
  "reach",
  "when",
  "regulars",
  "stopped",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export const AGGREGATES = ["count", "sum", "avg"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

const fieldId = z.string().max(64);

/** One widget's settings. Every key is optional; what a type reads is in its notes below. */
export const widgetConfigSchema = z
  .object({
    /** A title of your own instead of the one made from the fields. */
    title: z.string().trim().max(80).optional(),
    /** The number to add up or average (number, over-time, top-values, goal, spread, compare). */
    field: fieldId.nullable().optional(),
    agg: z.enum(AGGREGATES).optional(),
    /** The date rows are placed by (CREATED when none is picked). */
    date: fieldId.optional(),
    /** The choice (or member) field to split by (breakdown, pipeline, top-values). */
    group: fieldId.optional(),
    bucket: z.enum(["week", "month"]).optional(),
    /** Goal: the target and the day to reach it by. */
    target: z.number().positive().max(1e12).optional(),
    by: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Overdue: who owns each row, and how many days untouched is stale. */
    owner: fieldId.optional(),
    staleDays: z.number().int().min(1).max(365).optional(),
    /** Table: the columns, and one choice to filter to. */
    columns: z.array(fieldId).max(8).optional(),
    filter: z
      .object({ field: fieldId, value: z.string().max(64) })
      .nullable()
      .optional(),
  })
  .strict();

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export interface ReportWidget {
  id: string;
  type: WidgetType;
  w: number;
  h: number | null;
  config: WidgetConfig;
}

export const reportWidgetsSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        type: z.enum(WIDGET_TYPES),
        w: z.number().int().min(1).max(BOARD_COLUMNS),
        h: z.number().int().min(1).max(MAX_ROWS).nullable(),
        config: widgetConfigSchema,
      })
      .strict(),
  )
  .max(MAX_WIDGETS);

/** A saved report's widgets, dropping any that no longer parse (never throws). */
export function readWidgets(raw: unknown): ReportWidget[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportWidget[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const parsed = reportWidgetsSchema.element.safeParse(item);
    if (!parsed.success || ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    out.push(parsed.data);
  }
  return out.slice(0, MAX_WIDGETS);
}

interface WidgetDef {
  title: string;
  /** What it shows, in the walkthrough and the + menu. */
  description: string;
  icon: string;
  w: number;
  h: number | null;
  /** Which sources it can read. */
  kinds: readonly SourceKind[];
  /**
   * The settings it starts with for a source, or null when the source has
   * nothing it can read (no number field for Spread, no choice for Breakdown).
   */
  setup: (s: SourceSummary) => WidgetConfig | null;
  /** Ticked in the walkthrough when it can be set up (my picks). */
  suggested: (s: SourceSummary) => boolean;
  /** Names people, or audits the data: owners and admins only. */
  adminOnly?: boolean;
}

const ROWS: readonly SourceKind[] = ["custom", "tasks", "expenses"];

const isNumber = (f: ReportField) => f.type === "NUMBER" || f.type === "CURRENCY";
const isChoice = (f: ReportField) => f.type === "SELECT";
const STATUS = /status|stage|state|step|phase/i;
const DUE = /due|deadline|return|expires|ends?\b|by\b|follow/i;

/**
 * The numbers a widget can add up: never a joined database's (one joined
 * row's amount repeats on every row that matches it, so a sum would count
 * it again and again).
 */
export function numberFields(s: Pick<SourceSummary, "fields">): ReportField[] {
  return s.fields.filter((f) => isNumber(f) && !f.id.startsWith("j."));
}
export function choiceFields(s: Pick<SourceSummary, "fields">): ReportField[] {
  return s.fields.filter(isChoice);
}
export function dateFields(s: Pick<SourceSummary, "fields">): ReportField[] {
  return s.fields.filter((f) => f.type === "DATE");
}
function statusField(s: SourceSummary): ReportField | undefined {
  return choiceFields(s).find((f) => STATUS.test(f.name) && (f.choices?.length ?? 0) >= 3);
}
function dueField(s: SourceSummary): ReportField | undefined {
  return dateFields(s).find((f) => DUE.test(f.name));
}
function ownerField(s: SourceSummary): ReportField | undefined {
  return s.fields.find((f) => f.type === "MEMBER");
}
/** The money field if there is one, or the first number. */
function mainNumber(s: SourceSummary): ReportField | undefined {
  return numberFields(s).find((f) => f.type === "CURRENCY") ?? numberFields(s)[0];
}
/** Dates that only finished rows have: placing rows by one counts the finished ones only. */
const ENDED = /complet|closed|finish|resolv|done|returned on|paid on/i;

/** The date rows are placed by: the first that isn't a due date or an end date, else when they were added. */
function mainDate(s: SourceSummary): string {
  const due = dueField(s);
  return dateFields(s).find((f) => f !== due && !ENDED.test(f.name))?.id ?? CREATED;
}
/** A choice to split by: not the status, when there's another. */
function mainChoice(s: SourceSummary): ReportField | undefined {
  const status = statusField(s);
  return choiceFields(s).find((f) => f !== status) ?? choiceFields(s)[0];
}

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  insights: {
    title: "Insights",
    description: "Claude reads the whole report and says what matters, with one thing to do next.",
    icon: "Sparkles",
    w: 4,
    h: null,
    kinds: ["custom", "tasks", "expenses", "events", "people"],
    setup: () => ({}),
    suggested: () => true,
  },
  number: {
    title: "Number",
    description: "One count, total or average, with its change since the period before.",
    icon: "Hash",
    w: 1,
    h: 1,
    kinds: ROWS,
    setup: (s) => {
      const money = numberFields(s).find((f) => f.type === "CURRENCY");
      return money
        ? { field: money.id, agg: "sum", date: mainDate(s) }
        : { field: null, agg: "count", date: mainDate(s) };
    },
    suggested: () => true,
  },
  "over-time": {
    title: "Over time",
    description: "Rows added, or a number summed, by week or month, against the period before.",
    icon: "ChartLine",
    w: 2,
    h: 1,
    kinds: ROWS,
    setup: (s) => {
      const money = numberFields(s).find((f) => f.type === "CURRENCY");
      return {
        date: mainDate(s),
        field: money?.id ?? null,
        agg: money ? "sum" : "count",
        bucket: "week",
      };
    },
    suggested: (s) => dateFields(s).length > 0 || s.kind !== "custom",
  },
  breakdown: {
    title: "Breakdown",
    description: "How rows split across a choice: category, team, type.",
    icon: "ChartPie",
    w: 2,
    h: 1,
    kinds: ROWS,
    setup: (s) => {
      const group = mainChoice(s);
      if (!group) return null;
      const money = numberFields(s).find((f) => f.type === "CURRENCY");
      return {
        group: group.id,
        field: money?.id ?? null,
        agg: money ? "sum" : "count",
        date: mainDate(s),
      };
    },
    suggested: (s) => choiceFields(s).length > 0,
  },
  pipeline: {
    title: "Pipeline",
    description: "Rows through a status, stage by stage, and how many get to each.",
    icon: "Filter",
    w: 2,
    h: null,
    kinds: ROWS,
    setup: (s) => {
      const group = statusField(s) ?? choiceFields(s).find((f) => (f.choices?.length ?? 0) >= 3);
      return group ? { group: group.id } : null;
    },
    suggested: (s) => Boolean(statusField(s)),
  },
  "top-values": {
    title: "Top values",
    description: "The rows that lead on a number: biggest, most, highest.",
    icon: "Trophy",
    w: 1,
    h: 2,
    kinds: ROWS,
    setup: (s) => {
      const field = mainNumber(s);
      return field ? { field: field.id, date: mainDate(s) } : null;
    },
    suggested: (s) => numberFields(s).length > 0,
  },
  goal: {
    title: "Goal",
    description: "A number against a target, with the pace it takes to get there.",
    icon: "Target",
    w: 1,
    h: 1,
    kinds: ROWS,
    setup: (s) => {
      const field = mainNumber(s);
      return { field: field?.id ?? null, agg: field ? "sum" : "count", date: mainDate(s) };
    },
    suggested: () => false,
  },
  compare: {
    title: "Compare periods",
    description: "These dates against the period before, number by number.",
    icon: "ArrowLeftRight",
    w: 2,
    h: 1,
    kinds: ROWS,
    setup: (s) => ({ date: mainDate(s) }),
    suggested: () => false,
  },
  calendar: {
    title: "Activity calendar",
    description: "A square a day: when things happen, and when they don't.",
    icon: "CalendarDays",
    w: 2,
    h: 1,
    kinds: ROWS,
    setup: (s) => ({ date: mainDate(s) }),
    suggested: () => false,
  },
  overdue: {
    title: "Overdue and stale",
    description: "Rows past their date, or untouched for a while, with who owns each.",
    icon: "AlarmClock",
    w: 2,
    h: null,
    kinds: ROWS,
    setup: (s) => {
      const due = dueField(s);
      const owner = ownerField(s);
      if (!due && !owner) return null;
      return {
        ...(due ? { date: due.id } : {}),
        ...(owner ? { owner: owner.id } : {}),
        ...(statusField(s) ? { group: statusField(s)!.id } : {}),
        staleDays: 30,
      };
    },
    suggested: (s) => Boolean(dueField(s) || ownerField(s)),
  },
  table: {
    title: "Table",
    description: "The rows that match a filter, in the columns you pick.",
    icon: "Table2",
    w: 4,
    h: null,
    kinds: ROWS,
    setup: (s) => ({ columns: s.fields.slice(0, 4).map((f) => f.id), filter: null }),
    suggested: () => false,
  },
  spread: {
    title: "Spread",
    description: "How a number is spread out, so one big value doesn't hide in an average.",
    icon: "ChartColumn",
    w: 2,
    h: 1,
    kinds: ROWS,
    setup: (s) => {
      const field = mainNumber(s);
      return field ? { field: field.id, date: mainDate(s) } : null;
    },
    suggested: () => false,
  },
  health: {
    title: "Database health",
    description: "Duplicates and empty fields, so the report can be trusted.",
    icon: "ShieldCheck",
    w: 2,
    h: null,
    kinds: ["custom"],
    setup: () => ({}),
    suggested: () => true,
    adminOnly: true,
  },
  "form-results": {
    title: "Form results",
    description: "How the form's choice questions were answered. Free-text answers never show.",
    icon: "ClipboardList",
    w: 2,
    h: null,
    kinds: ["custom"],
    setup: (s) => (s.form && choiceFields(s).length > 0 ? {} : null),
    suggested: (s) => Boolean(s.form),
  },
  people: {
    title: "People",
    description: "Members, the board, open roles and who's new.",
    icon: "Users",
    w: 2,
    h: null,
    kinds: ["people"],
    setup: () => ({}),
    suggested: () => true,
  },
  attendance: {
    title: "Attendance over time",
    description: "Check-ins at each event against the average.",
    icon: "ChartLine",
    w: 4,
    h: null,
    kinds: ["events"],
    setup: () => ({}),
    suggested: () => true,
  },
  rsvps: {
    title: "RSVPs and check-ins",
    description: "Who said they'd come against who did, event by event.",
    icon: "Ticket",
    w: 4,
    h: null,
    kinds: ["events"],
    setup: () => ({}),
    suggested: () => true,
  },
  retention: {
    title: "Retention",
    description: "New against returning, and who stopped coming.",
    icon: "Activity",
    w: 4,
    h: null,
    kinds: ["events", "people"],
    setup: () => ({}),
    suggested: (s) => s.kind === "events",
  },
  journey: {
    title: "From signup to regular",
    description: "Everyone who signed up, and how many came once, twice and three or more times.",
    icon: "Filter",
    w: 2,
    h: null,
    kinds: ["events", "people"],
    setup: () => ({}),
    suggested: () => false,
  },
  reach: {
    title: "Who you reach",
    description: "Who comes, by the year on their signup, against who signed up.",
    icon: "Users",
    w: 2,
    h: null,
    kinds: ["events", "people"],
    setup: () => ({}),
    suggested: () => false,
  },
  when: {
    title: "When people come",
    description: "Turnout by weekday and time of day, for picking the next slot.",
    icon: "CalendarDays",
    w: 2,
    h: null,
    kinds: ["events"],
    setup: () => ({}),
    suggested: () => false,
  },
  regulars: {
    title: "Regulars",
    description: "Who shows up most. Names people, so owners and admins only.",
    icon: "Trophy",
    w: 1,
    h: null,
    kinds: ["events", "people"],
    setup: () => ({}),
    suggested: () => false,
    adminOnly: true,
  },
  stopped: {
    title: "Stopped coming",
    description: "People who came often and then stopped, with one button to invite them back.",
    icon: "AlarmClock",
    w: 2,
    h: null,
    kinds: ["events", "people"],
    setup: () => ({}),
    suggested: () => false,
    adminOnly: true,
  },
};

/** The widgets that can go on a report of `source`, in catalog order. */
export function widgetsFor(source: SourceSummary, isAdmin: boolean): WidgetType[] {
  return WIDGET_TYPES.filter((t) => {
    const def = WIDGETS[t];
    if (!def.kinds.includes(source.kind)) return false;
    if (def.adminOnly && !isAdmin) return false;
    return def.setup(source) !== null;
  });
}

/** The walkthrough's ticked widgets for a source, Insights first. */
export function suggestedWidgets(source: SourceSummary, isAdmin: boolean): WidgetType[] {
  return widgetsFor(source, isAdmin).filter((t) => WIDGETS[t].suggested(source));
}

/** A new widget of `type` on `source`, sized as the catalog says. */
export function newWidget(
  type: WidgetType,
  source: SourceSummary,
  taken: readonly { id: string }[],
): ReportWidget {
  const def = WIDGETS[type];
  const ids = new Set(taken.map((w) => w.id));
  let id: string = type;
  for (let i = 2; ids.has(id); i++) id = `${type}-${i}`;
  return { id, type, w: def.w, h: def.h, config: def.setup(source) ?? {} };
}

/** The board's widget menu for a source (WidgetBoard's types). */
export function boardTypes(source: SourceSummary, isAdmin: boolean): WidgetMeta[] {
  return widgetsFor(source, isAdmin).map((t) => {
    // The People and Events widgets are the built-in report cards, which draw their own surface.
    const builtIn = ["people", "attendance", "rsvps", "retention"].includes(t);
    return {
      type: t,
      title: WIDGETS[t].title,
      description: WIDGETS[t].description,
      group: builtIn ? "People and events" : "Widgets",
      icon: WIDGETS[t].icon,
      w: WIDGETS[t].w,
      h: WIDGETS[t].h,
      ...(builtIn ? { frame: "bare" as const } : {}),
    };
  });
}

function fieldName(
  source: Pick<SourceSummary, "fields">,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  if (id === CREATED) return "Date added";
  return source.fields.find((f) => f.id === id)?.name ?? null;
}

/**
 * A widget's title: its own, or one made from what it reads ("Amount by
 * Category", "Sponsors by week"), so a report of eight widgets reads like a
 * list of questions rather than eight "Breakdown"s.
 */
/** "amount" mid-title, but "CBC sponsors" as written. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

export function widgetTitle(
  widget: Pick<ReportWidget, "type" | "config">,
  source: Pick<SourceSummary, "fields" | "name">,
): string {
  const c = widget.config;
  if (c.title) return c.title;
  const value = fieldName(source, c.field);
  const group = fieldName(source, c.group);
  switch (widget.type) {
    case "number":
      return value
        ? `${c.agg === "avg" ? "Average" : "Total"} ${lowerFirst(value)}`
        : `${source.name} added`;
    case "over-time":
      return `${value ?? source.name} by ${c.bucket ?? "week"}`;
    case "breakdown":
      return group ? `${value ?? source.name} by ${lowerFirst(group)}` : WIDGETS.breakdown.title;
    case "pipeline":
      return group ? `${source.name} by ${lowerFirst(group)}` : WIDGETS.pipeline.title;
    case "top-values":
      return value
        ? `Top ${lowerFirst(source.name)} by ${lowerFirst(value)}`
        : WIDGETS["top-values"].title;
    case "spread":
      return value ? `${value} spread` : WIDGETS.spread.title;
    case "goal":
      return value ? `Goal: total ${lowerFirst(value)}` : `Goal: ${lowerFirst(source.name)} added`;
    default:
      return WIDGETS[widget.type].title;
  }
}

/** The fields a widget reads, named, for the walkthrough's "Uses Amount, Category". */
export function widgetUses(
  widget: Pick<ReportWidget, "config">,
  source: Pick<SourceSummary, "fields">,
): string[] {
  const c = widget.config;
  return [c.field, c.group, c.date, c.owner]
    .map((id) => fieldName(source, id))
    .filter((n): n is string => Boolean(n));
}

export const REPORT_TITLE_MAX = 80;
export const reportTitleSchema = z.string().trim().min(1, "Name the report.").max(REPORT_TITLE_MAX);

/** A widget at its catalog size, before rows are filled. */
export function naturalSize<T extends { type: WidgetType; w: number; h: number | null }>(w: T): T {
  return { ...w, w: WIDGETS[w.type].w, h: WIDGETS[w.type].h };
}
