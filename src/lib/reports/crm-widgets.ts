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
] as const;
export const CRM_LIST_WIDGETS = [
  "crm-by-member",
  "crm-campaigns",
  "crm-conversion",
  "crm-time-in-stage",
  "crm-by-source",
  "crm-raised-by-source",
  "crm-goals",
] as const;
export const CRM_WIDGET_TYPES = [...CRM_STAT_WIDGETS, ...CRM_LIST_WIDGETS] as const;

export type CrmStatWidget = (typeof CRM_STAT_WIDGETS)[number];
export type CrmListWidget = (typeof CRM_LIST_WIDGETS)[number];
export type CrmWidgetType = (typeof CRM_WIDGET_TYPES)[number];

export function isCrmWidget(type: string): type is CrmWidgetType {
  return (CRM_WIDGET_TYPES as readonly string[]).includes(type);
}

export type CrmValueFormat = "number" | "money" | "percent" | "hours" | "days" | "perDay";

export interface CrmStatPayload {
  value: number | null;
  format: CrmValueFormat;
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
}

export interface CrmListPayload {
  rows: { key: string; label: string; value: number; display: string; detail?: string | null; href?: string | null }[];
  /** The full-width value of a bar (conversion: the first stage's count). */
  max?: number | null;
  caption: string | null;
  empty: string;
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
};

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
export function formatCrmValue(value: number | null, format: CrmValueFormat): string {
  if (value === null || !Number.isFinite(value)) return "None yet";
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 || Math.abs(cents) >= 100_000 ? 0 : 2 }).format(cents / 100);
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
