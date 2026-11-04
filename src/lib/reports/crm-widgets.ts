import type { HeatGrid } from "@/lib/crm/crm-reports";

import type { SourceSummary, WidgetConfig } from "./catalog";

/**
 * The CRM's outreach and pipeline widgets (docs/features/crm.md, module 7),
 * offered on reports of the CRM's databases (People, Companies, a
 * pipeline). They read the CRM's own tables (timeline, email, campaigns,
 * field history, goals) on the server (src/server/crm/report-widgets.ts),
 * as the viewer, and draw one of two shapes: a stat (one number with its
 * parts) or a ranked list. Pure and client-safe: catalog.ts adds them to
 * the widget catalog.
 */

export const CRM_STAT_WIDGETS = [
  "crm-reached",
  "crm-reply-rate",
  "crm-first-reply",
  "crm-overdue",
  "crm-cold",
  "crm-velocity",
  "crm-talked-to",
  "crm-won",
  "crm-open",
  "crm-quiet",
  "crm-sent",
  "crm-unsubscribes",
] as const;
export const CRM_LIST_WIDGETS = [
  "crm-by-member",
  "crm-campaigns",
  "crm-conversion",
  "crm-time-in-stage",
  "crm-by-source",
  "crm-raised-by-source",
  "crm-goals",
  "crm-converted",
  "crm-top-issues",
  "crm-won-months",
  "crm-deals-by-stage",
  "crm-deals-by-owner",
  "crm-deals-by-type",
  "crm-people-months",
  "crm-people-by-relationship",
  "crm-people-by-owner",
  "crm-replies-by-plan",
] as const;
export const CRM_GRID_WIDGETS = ["crm-best-time"] as const;
export const CRM_WIDGET_TYPES = [...CRM_STAT_WIDGETS, ...CRM_LIST_WIDGETS, ...CRM_GRID_WIDGETS] as const;

export type CrmStatWidget = (typeof CRM_STAT_WIDGETS)[number];
export type CrmListWidget = (typeof CRM_LIST_WIDGETS)[number];
export type CrmGridWidget = (typeof CRM_GRID_WIDGETS)[number];
export type CrmWidgetType = (typeof CRM_WIDGET_TYPES)[number];

export function isCrmWidget(type: string): type is CrmWidgetType {
  return (CRM_WIDGET_TYPES as readonly string[]).includes(type);
}

export type CrmValueFormat = "number" | "money" | "percent" | "hours" | "days" | "perDay";

/** A sentence a CRM widget adds to the report's built-in Insights. */
export interface CrmLine {
  text: string;
  tone: "info" | "good" | "warn";
  bold?: string | null;
  next?: string | null;
}

export interface CrmStatPayload {
  value: number | null;
  format: CrmValueFormat;
  /** A money value's currency (a pipeline's own); USD when left out. */
  currency?: string;
  /** The same number over the span before (null: no span to compare). */
  previous: number | null;
  deltaPct: number | null;
  /** The line under the number: what it counts. */
  caption: string;
  /** The parts it's made of (velocity: open items, win rate, average, days). */
  parts: { label: string; value: string }[];
  /** A few rows behind it (follow-ups overdue, going cold), with links. */
  rows: { key: string; label: string; detail: string | null; href: string | null }[];
  /** Said instead of the number when there's nothing to count. */
  empty: string | null;
  /** Going quiet: the people Add to Power hour puts in tomorrow's list. */
  queue?: string[];
  line?: CrmLine | null;
}

export interface CrmListRow {
  key: string;
  label: string;
  value: number;
  display: string;
  detail?: string | null;
  href?: string | null;
  /** The records behind the row (top issues: the people who have it). */
  links?: { key: string; label: string; href: string }[];
}

export interface CrmListPayload {
  rows: CrmListRow[];
  /** The full-width value of a bar (conversion: the first stage's count). */
  max?: number | null;
  caption: string | null;
  empty: string;
  /** Bars (the default), or columns for a by-month count. */
  shape?: "bars" | "columns";
  /** One figure above the bars (Converted: the count and its rate). */
  headline?: { value: string; detail: string } | null;
  line?: CrmLine | null;
  /**
   * Top issues: every issue as written, grouped by exact text, for the
   * report page to group by meaning with the organization's AI (outside
   * the transaction). Taken off before the page draws or keeps a copy.
   */
  issues?: IssueGroup[];
}

/** People who share one issue. */
export interface IssueGroup {
  label: string;
  people: { id: string; name: string }[];
}

/** Best day and time: reply rate by weekday and part of the day. */
export interface CrmGridPayload extends HeatGrid {
  caption: string;
  empty: string | null;
  line?: CrmLine | null;
}

/** A CRM report source: which of the CRM's databases it is. */
export interface CrmSourceInfo {
  kind: "people" | "companies" | "pipeline";
  pipelineId?: string;
  hasAmount?: boolean;
}

interface CrmWidgetDef {
  title: string;
  description: string;
  icon: string;
  w: number;
  h: number | null;
  /** Pipelines only. */
  pipeline?: boolean;
  /** Pipelines with amounts only. */
  money?: boolean;
  suggestedOn: readonly CrmSourceInfo["kind"][];
}

export const CRM_WIDGETS: Record<CrmWidgetType, CrmWidgetDef> = {
  "crm-reached": {
    title: "People reached",
    description: "Different people emailed, called, texted or met, against the period before.",
    icon: "Users",
    w: 1,
    h: 1,
    suggestedOn: ["people"],
  },
  "crm-reply-rate": {
    title: "Reply rate",
    description: "Of the people emailed, how many wrote back.",
    icon: "Activity",
    w: 1,
    h: 1,
    suggestedOn: ["people"],
  },
  "crm-first-reply": {
    title: "Time to first reply",
    description: "How long people take to write back, middle of the pack.",
    icon: "AlarmClock",
    w: 1,
    h: 1,
    suggestedOn: [],
  },
  "crm-overdue": {
    title: "Follow-ups overdue",
    description: "People whose follow-up date has passed, the oldest first.",
    icon: "AlarmClock",
    w: 1,
    h: 2,
    suggestedOn: ["people"],
  },
  "crm-cold": {
    title: "Relationships going cold",
    description: "People you knew well who haven't heard from anyone in two months.",
    icon: "Activity",
    w: 1,
    h: 2,
    suggestedOn: ["people"],
  },
  "crm-velocity": {
    title: "Pipeline velocity",
    description: "Open items times success rate times average amount, divided by days to close.",
    icon: "ChartLine",
    w: 2,
    h: 1,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-by-member": {
    title: "Outreach by member",
    description: "Who reached out to how many people, and how many replied.",
    icon: "Users",
    w: 2,
    h: null,
    suggestedOn: ["people"],
  },
  "crm-campaigns": {
    title: "Campaign progress",
    description: "Each campaign: contacted, replied, booked, against its goal.",
    icon: "Target",
    w: 2,
    h: null,
    suggestedOn: [],
  },
  "crm-conversion": {
    title: "Stage-to-stage conversion",
    description: "How many items reach each stage, and the share that get from one to the next.",
    icon: "Filter",
    w: 2,
    h: null,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-time-in-stage": {
    title: "Time in stage",
    description: "The average days items spend in each stage.",
    icon: "ChartColumn",
    w: 2,
    h: null,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-by-source": {
    title: "Conversion by source",
    description: "Which form, event or list brought the items that were won.",
    icon: "ArrowLeftRight",
    w: 2,
    h: null,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-raised-by-source": {
    title: "Amounts raised by source",
    description: "What was won, added up by where it came from.",
    icon: "Handshake",
    w: 2,
    h: null,
    pipeline: true,
    money: true,
    suggestedOn: ["pipeline"],
  },
  "crm-goals": {
    title: "Goals",
    description: "This quarter's and year's goals, with how far along each is.",
    icon: "Trophy",
    w: 2,
    h: null,
    suggestedOn: ["people", "pipeline"],
  },
  "crm-talked-to": {
    title: "People talked to",
    description: "Different people who wrote back, took a call or met with you, and their share of People.",
    icon: "MessageSquare",
    w: 1,
    h: null,
    suggestedOn: ["people", "pipeline"],
  },
  "crm-converted": {
    title: "Converted",
    description: "Of the people talked to, how many became a member, client or partner, or have a won deal.",
    icon: "Filter",
    w: 1,
    h: null,
    suggestedOn: ["people", "pipeline"],
  },
  "crm-top-issues": {
    title: "Top issues",
    description: "The biggest issue people have, the most common first, with who has each.",
    icon: "Lightbulb",
    w: 2,
    h: null,
    suggestedOn: ["people", "pipeline"],
  },
  "crm-won": {
    title: "Won",
    description: "Deals that reached a won stage, against the period before and the goal.",
    icon: "Trophy",
    w: 1,
    h: 1,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-open": {
    title: "Still open",
    description: "Deals not won or lost yet, and how many have a dated next step.",
    icon: "Handshake",
    w: 1,
    h: 1,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-won-months": {
    title: "Won over time",
    description: "What was won each month.",
    icon: "ChartColumn",
    w: 2,
    h: 1,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-deals-by-stage": {
    title: "By stage",
    description: "Where the deals sit now, stage by stage.",
    icon: "Filter",
    w: 2,
    h: null,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-deals-by-owner": {
    title: "By owner",
    description: "What each owner won in these dates.",
    icon: "Users",
    w: 1,
    h: null,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-deals-by-type": {
    title: "By type",
    description: "Open and won deals split by their type.",
    icon: "ChartPie",
    w: 1,
    h: null,
    pipeline: true,
    suggestedOn: ["pipeline"],
  },
  "crm-people-months": {
    title: "New people by month",
    description: "People added to People each month.",
    icon: "ChartColumn",
    w: 2,
    h: 1,
    suggestedOn: ["people"],
  },
  "crm-quiet": {
    title: "Going quiet",
    description: "People with no touch in 60 days or more, the most recent first.",
    icon: "AlarmClock",
    w: 2,
    h: 1,
    suggestedOn: ["people"],
  },
  "crm-people-by-relationship": {
    title: "By relationship",
    description: "Everyone in People, split by relationship.",
    icon: "ChartPie",
    w: 2,
    h: null,
    suggestedOn: ["people"],
  },
  "crm-people-by-owner": {
    title: "People by owner",
    description: "The people each member looks after.",
    icon: "Users",
    w: 2,
    h: null,
    suggestedOn: ["people"],
  },
  "crm-sent": {
    title: "Sent",
    description: "Emails and texts from every plan, against the period before.",
    icon: "Send",
    w: 1,
    h: 1,
    suggestedOn: [],
  },
  "crm-replies-by-plan": {
    title: "Replies by plan",
    description: "Which sequences and campaigns get the most replies.",
    icon: "ChartColumn",
    w: 2,
    h: null,
    suggestedOn: [],
  },
  "crm-best-time": {
    title: "Best day and time",
    description: "Reply rate by weekday and part of the day, your organization's time.",
    icon: "CalendarDays",
    w: 2,
    h: null,
    suggestedOn: [],
  },
  "crm-unsubscribes": {
    title: "Unsubscribes",
    description: "People who asked not to be emailed, and after which plan.",
    icon: "Mail",
    w: 2,
    h: 1,
    suggestedOn: [],
  },
};

/** The sentences the CRM widgets add to a report's built-in Insights, the pressing ones first. */
export function crmInsightLines(
  computed: readonly { widget: { id: string; type: string }; title: string; payload: { type: string; data: unknown } | null }[],
): { text: string; tone: CrmLine["tone"]; widgetId: string; label: string; bold: string | null; next: string | null }[] {
  const out = [];
  for (const c of computed) {
    if (!c.payload || !isCrmWidget(c.payload.type)) continue;
    const line = (c.payload.data as { line?: CrmLine | null }).line;
    if (!line) continue;
    out.push({
      text: line.text,
      tone: line.tone,
      widgetId: c.widget.id,
      label: c.title,
      bold: line.bold ?? null,
      next: line.next ?? null,
    });
  }
  return [...out.filter((l) => l.tone === "warn"), ...out.filter((l) => l.tone !== "warn")];
}

/** The settings a CRM widget starts with on a source, or null when it can't go there. */
export function crmWidgetSetup(type: CrmWidgetType, s: Pick<SourceSummary, "crm">): WidgetConfig | null {
  const def = CRM_WIDGETS[type];
  if (!s.crm) return null;
  if (def.pipeline && s.crm.kind !== "pipeline") return null;
  if (def.money && !s.crm.hasAmount) return null;
  return {};
}

export function crmWidgetSuggested(type: CrmWidgetType, s: Pick<SourceSummary, "crm">): boolean {
  return Boolean(s.crm && CRM_WIDGETS[type].suggestedOn.includes(s.crm.kind) && crmWidgetSetup(type, s));
}

/** "$1,500", "42%", "3.5 hours", "12 days", "$40 a day". */
export function formatCrmValue(value: number | null, format: CrmValueFormat, currency = "USD"): string {
  if (value === null || !Number.isFinite(value)) return "None yet";
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 || Math.abs(cents) >= 100_000 ? 0 : 2 }).format(cents / 100);
  switch (format) {
    case "money":
      return money(value);
    case "perDay":
      return `${money(value)} a day`;
    case "percent":
      return `${Math.round(value * 100)}%`;
    case "hours": {
      if (value >= 48) return `${Math.round(value / 24)} days`;
      const h = Math.round(value * 10) / 10;
      return `${h} ${h === 1 ? "hour" : "hours"}`;
    }
    case "days": {
      const d = Math.round(value * 10) / 10;
      return `${d} ${d === 1 ? "day" : "days"}`;
    }
    default:
      return value.toLocaleString("en-US");
  }
}
