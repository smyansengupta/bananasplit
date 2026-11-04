import { fillRows, type ReportWidget, type SourceSummary, type WidgetType } from "./catalog";
import { CRM_WIDGETS, type CrmWidgetType } from "./crm-widgets";

/**
 * The CRM's ready-made reports in Databases > Reports (docs/features/crm.md,
 * "Reports"): Deals on each pipeline, People and Outreach on People. Each
 * is an ordinary saved report on the CRM's own database, made from these
 * widgets, so it's arranged, shared, scheduled and kept like any other.
 * The classics (People talked to, Converted, Top issues) open Deals and
 * People. Pure and client-safe: setup, the Report buttons and Reports home
 * read it.
 */

export type ReadyKind = "deals" | "people" | "outreach";

interface Slot {
  type: WidgetType;
  w: number;
  h: number | null;
}

const at = (type: CrmWidgetType | "insights", w: number, h: number | null): Slot => ({ type, w, h });

const CLASSICS: Slot[] = [at("crm-talked-to", 1, null), at("crm-converted", 1, null), at("crm-top-issues", 2, null)];

const LAYOUTS: Record<ReadyKind, Slot[]> = {
  deals: [
    at("insights", 4, null),
    ...CLASSICS,
    at("crm-won", 1, 1),
    at("crm-open", 1, 1),
    at("crm-won-months", 2, 1),
    at("crm-deals-by-stage", 2, null),
    at("crm-deals-by-owner", 1, null),
    at("crm-deals-by-type", 1, null),
  ],
  people: [
    at("insights", 4, null),
    ...CLASSICS,
    at("crm-people-months", 2, 1),
    at("crm-quiet", 2, 1),
    at("crm-people-by-relationship", 2, null),
    at("crm-people-by-owner", 2, null),
  ],
  outreach: [
    at("insights", 4, null),
    at("crm-sent", 1, 1),
    at("crm-reply-rate", 1, 1),
    at("crm-unsubscribes", 2, 1),
    at("crm-replies-by-plan", 2, null),
    at("crm-best-time", 2, null),
  ],
};

/**
 * The widget that marks a report as this ready-made one: a live report on
 * the same database with it is the one the CRM's Report buttons open.
 */
export const READY_MARK: Record<ReadyKind, CrmWidgetType> = {
  deals: "crm-won",
  people: "crm-talked-to",
  outreach: "crm-sent",
};

export interface ReadyReport {
  kind: ReadyKind;
  title: string;
  description: string;
  source: string;
  widgets: ReportWidget[];
}

const DESCRIPTIONS: Record<ReadyKind, string> = {
  deals: "Talked to, converted and top issues, then won, still open, by stage, owner and type",
  people: "Talked to, converted and top issues, then new people, going quiet, by relationship and owner",
  outreach: "Sent, reply rate, replies by plan, the best day and time, unsubscribes",
};

/** The ready-made reports a source has: Deals on a pipeline, People and Outreach on People. */
export function readyKindsFor(source: Pick<SourceSummary, "crm">): ReadyKind[] {
  if (!source.crm) return [];
  if (source.crm.kind === "pipeline") return ["deals"];
  if (source.crm.kind === "people") return ["people", "outreach"];
  return [];
}

/** The ready-made report of `kind` on `source`, its widgets laid out in full rows. */
export function readyReport(kind: ReadyKind, source: Pick<SourceSummary, "key" | "name" | "crm">): ReadyReport {
  const widgets: ReportWidget[] = LAYOUTS[kind]
    .filter((p) => p.type === "insights" || !CRM_WIDGETS[p.type as CrmWidgetType]?.money || source.crm?.hasAmount)
    .map((p) => ({ id: p.type, type: p.type, w: p.w, h: p.h, config: {} }));
  return {
    kind,
    title: kind === "deals" ? source.name : kind === "people" ? "People" : "Outreach",
    description: DESCRIPTIONS[kind],
    source: source.key,
    widgets: fillRows(widgets),
  };
}

/** Every ready-made report the viewer's sources offer. */
export function readyReports(sources: readonly SourceSummary[]): ReadyReport[] {
  return sources.flatMap((s) => readyKindsFor(s).map((k) => readyReport(k, s)));
}

/** Whether a report (its database and widgets) is the ready-made one of `kind`. */
export function isReadyReport(
  report: { source: string; widgets: readonly { type: string }[] },
  kind: ReadyKind,
  sourceKey: string,
): boolean {
  return report.source === sourceKey && report.widgets.some((w) => w.type === READY_MARK[kind]);
}
