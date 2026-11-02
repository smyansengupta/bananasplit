import type { ReportAccess, Role } from "@/generated/prisma/enums";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import type { BoardWidget } from "@/lib/boards";
import {
  WIDGETS,
  newWidget,
  readWidgets,
  reportTitleSchema,
  reportWidgetsSchema,
  widgetsFor,
  type ReportWidget,
  type SourceSummary,
  type WidgetType,
} from "@/lib/reports/catalog";
import type { ComputedWidget, InsightLine, WidgetPayload } from "@/lib/reports/compute";
import type { TxClient } from "@/server/db/context";
import { AppError } from "@/server/db/errors";

import { listSources, type SourceViewer } from "./sources";

/**
 * Saved reports and their snapshots (Report, ReportSnapshot). RLS decides
 * who sees and edits one (20261102140000_saved_reports); these check the
 * same things first so the person gets a sentence, not a refused write.
 */

export class ReportInputError extends AppError {
  constructor(message: string) {
    super(message, 422, "REPORT_INPUT");
    this.name = "ReportInputError";
  }
}

export interface ReportSummary {
  id: string;
  title: string;
  source: string;
  access: ReportAccess;
  widgets: ReportWidget[];
  createdById: string | null;
  createdByName: string | null;
  updatedAt: string;
  snapshots: number;
  lastSnapshotAt: string | null;
  insights: { lines: InsightLine[]; at: string } | null;
}

export interface SnapshotWidget {
  id: string;
  type: WidgetType;
  w: number;
  h: number | null;
  title: string;
  payload: WidgetPayload | null;
}

export interface SnapshotData {
  title: string;
  sourceName: string;
  widgets: SnapshotWidget[];
}

export interface SnapshotSummary {
  id: string;
  reportId: string;
  reportTitle: string;
  rangeLabel: string;
  takenAt: string;
  takenByName: string | null;
}

function readInsights(raw: unknown, at: Date | null): ReportSummary["insights"] {
  if (!raw || typeof raw !== "object" || !at) return null;
  const lines = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return null;
  const ok = lines.filter(
    (l): l is InsightLine =>
      Boolean(l) &&
      typeof (l as InsightLine).text === "string" &&
      ["info", "good", "warn"].includes((l as InsightLine).tone),
  );
  return { lines: ok.slice(0, 6), at: at.toISOString() };
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  source: true,
  access: true,
  widgets: true,
  createdById: true,
  updatedAt: true,
  insights: true,
  insightsAt: true,
  createdBy: { select: { name: true } },
  _count: { select: { snapshots: true } },
  snapshots: { select: { takenAt: true }, orderBy: { takenAt: "desc" }, take: 1 },
} as const;

type SummaryRow = {
  id: string;
  title: string;
  source: string;
  access: ReportAccess;
  widgets: unknown;
  createdById: string | null;
  updatedAt: Date;
  insights: unknown;
  insightsAt: Date | null;
  createdBy: { name: string | null } | null;
  _count: { snapshots: number };
  snapshots: { takenAt: Date }[];
};

function toSummary(r: SummaryRow): ReportSummary {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    access: r.access,
    widgets: readWidgets(r.widgets),
    createdById: r.createdById,
    createdByName: r.createdBy?.name ?? null,
    updatedAt: r.updatedAt.toISOString(),
    snapshots: r._count.snapshots,
    lastSnapshotAt: r.snapshots[0]?.takenAt.toISOString() ?? null,
    insights: readInsights(r.insights, r.insightsAt),
  };
}

/** The reports the viewer sees (theirs and the shared ones), most recently changed first. */
export async function listReports(db: TxClient, organizationId: string): Promise<ReportSummary[]> {
  const rows = await db.report.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: SUMMARY_SELECT,
  });
  return rows.map(toSummary);
}

export async function getReport(
  db: TxClient,
  organizationId: string,
  id: string,
): Promise<ReportSummary> {
  const row = await db.report.findFirst({
    where: { organizationId, id, archivedAt: null },
    select: SUMMARY_SELECT,
  });
  if (!row) throw new NotFoundError();
  return toSummary(row);
}

/** Whoever made it, or an owner/admin on a shared one (the same rule as the UPDATE policy). */
export function canEditReport(
  report: Pick<ReportSummary, "createdById" | "access">,
  userId: string,
  role: Role,
): boolean {
  if (report.createdById === userId) return true;
  return report.access === "ORGANIZATION" && can({ role }, "databases.write");
}

function isAdmin(role: Role): boolean {
  return can({ role }, "databases.write");
}

/**
 * The widgets as saved: only the ones the source can show to this role, each
 * set up for the source, Insights kept first.
 */
function cleanWidgets(widgets: ReportWidget[], source: SourceSummary, role: Role): ReportWidget[] {
  const allowed = new Set(widgetsFor(source, isAdmin(role)));
  const kept = widgets.filter((w) => allowed.has(w.type));
  const insights = kept.filter((w) => w.type === "insights").slice(0, 1);
  return [...insights, ...kept.filter((w) => w.type !== "insights")];
}

async function sourceFor(v: SourceViewer, key: string): Promise<SourceSummary> {
  const source = (await listSources(v)).find((s) => s.key === key);
  if (!source) throw new ReportInputError("That database isn't there, or you can't see it.");
  return source;
}

export interface CreateReportInput {
  title: string;
  source: string;
  access: ReportAccess;
  /** The walkthrough's picks, in order, with their shapes and settings. */
  widgets: unknown;
}

export async function createReport(v: SourceViewer, input: CreateReportInput): Promise<string> {
  const title = reportTitleSchema.safeParse(input.title);
  if (!title.success)
    throw new ReportInputError(title.error.issues[0]?.message ?? "Name the report.");
  const parsed = reportWidgetsSchema.safeParse(input.widgets);
  if (!parsed.success) throw new ReportInputError("Those widgets couldn't be saved. Try again.");
  const source = await sourceFor(v, input.source);
  const widgets = cleanWidgets(parsed.data, source, v.role);
  if (widgets.length === 0) throw new ReportInputError("Pick at least one widget.");
  const report = await v.db.report.create({
    data: {
      organizationId: v.organizationId,
      title: title.data,
      source: source.key,
      access: input.access,
      widgets: widgets as object[],
      createdById: v.userId,
    },
    select: { id: true },
  });
  return report.id;
}

async function editable(v: SourceViewer, id: string): Promise<ReportSummary> {
  const report = await getReport(v.db, v.organizationId, id);
  if (!canEditReport(report, v.userId, v.role)) {
    throw new ReportInputError(
      "Only whoever made this report, or an owner or admin, can change it.",
    );
  }
  return report;
}

/**
 * A board save from the report page: the order and shapes the board sends,
 * with each widget's settings kept by id. A widget the board just added has
 * none yet, so it's set up for the source here. null puts the report back
 * to the walkthrough's suggested widgets.
 */
export async function saveReportLayout(
  v: SourceViewer,
  id: string,
  layout: BoardWidget[] | null,
): Promise<void> {
  const report = await editable(v, id);
  const source = await sourceFor(v, report.source);
  const byId = new Map(report.widgets.map((w) => [w.id, w]));
  let next: ReportWidget[];
  if (layout === null) {
    const taken: ReportWidget[] = [];
    for (const type of widgetsFor(source, isAdmin(v.role)).filter((t) =>
      WIDGETS[t].suggested(source),
    )) {
      taken.push(newWidget(type, source, taken));
    }
    next = taken;
  } else {
    next = layout.map((b) => {
      const was = byId.get(b.id);
      if (was && was.type === b.type) return { ...was, w: b.w, h: b.h };
      return { ...newWidget(b.type as WidgetType, source, []), id: b.id, w: b.w, h: b.h };
    });
  }
  const parsed = reportWidgetsSchema.safeParse(cleanWidgets(next, source, v.role));
  if (!parsed.success) throw new ReportInputError("That layout couldn't be saved.");
  await v.db.report.update({ where: { id }, data: { widgets: parsed.data as object[] } });
}

/** One widget's settings changed (its fields, title, target...). */
export async function saveWidgetConfig(
  v: SourceViewer,
  id: string,
  widgetId: string,
  config: unknown,
): Promise<void> {
  const report = await editable(v, id);
  const at = report.widgets.findIndex((w) => w.id === widgetId);
  if (at < 0) throw new ReportInputError("That widget isn't on the report any more.");
  const next = [...report.widgets];
  next[at] = { ...next[at], config: config as ReportWidget["config"] };
  const parsed = reportWidgetsSchema.safeParse(next);
  if (!parsed.success) throw new ReportInputError("Those settings couldn't be saved.");
  await v.db.report.update({ where: { id }, data: { widgets: parsed.data as object[] } });
}

export async function updateReportDetails(
  v: SourceViewer,
  id: string,
  input: { title?: string; access?: ReportAccess },
): Promise<void> {
  const report = await editable(v, id);
  const data: { title?: string; access?: ReportAccess } = {};
  if (input.title !== undefined) {
    const title = reportTitleSchema.safeParse(input.title);
    if (!title.success)
      throw new ReportInputError(title.error.issues[0]?.message ?? "Name the report.");
    data.title = title.data;
  }
  if (input.access !== undefined) {
    if (report.createdById !== v.userId)
      throw new ReportInputError("Only whoever made this report can change who sees it.");
    data.access = input.access;
  }
  await v.db.report.update({ where: { id }, data });
}

export async function archiveReport(v: SourceViewer, id: string): Promise<void> {
  await editable(v, id);
  await v.db.report.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function saveInsights(
  v: SourceViewer,
  id: string,
  lines: InsightLine[],
): Promise<void> {
  await getReport(v.db, v.organizationId, id);
  await v.db.report.update({
    where: { id },
    data: { insights: { lines } as object, insightsAt: new Date() },
  });
}

/** Freezes the report as it reads now, for Past reports. */
export async function takeSnapshot(
  v: SourceViewer,
  report: Pick<ReportSummary, "id" | "title">,
  sourceName: string,
  rangeLabel: string,
  computed: readonly ComputedWidget[],
): Promise<string> {
  const data: SnapshotData = {
    title: report.title,
    sourceName,
    widgets: computed.map((c) => ({
      id: c.widget.id,
      type: c.widget.type,
      w: c.widget.w,
      h: c.widget.h,
      title: c.title,
      payload: c.payload,
    })),
  };
  const row = await v.db.reportSnapshot.create({
    data: {
      organizationId: v.organizationId,
      reportId: report.id,
      takenById: v.userId,
      rangeLabel: rangeLabel.slice(0, 80),
      data: data as object,
    },
    select: { id: true },
  });
  return row.id;
}

export async function listSnapshots(
  db: TxClient,
  organizationId: string,
  reportId?: string,
): Promise<SnapshotSummary[]> {
  const rows = await db.reportSnapshot.findMany({
    where: { organizationId, ...(reportId ? { reportId } : {}), report: { archivedAt: null } },
    orderBy: { takenAt: "desc" },
    take: 60,
    select: {
      id: true,
      reportId: true,
      rangeLabel: true,
      takenAt: true,
      takenBy: { select: { name: true } },
      report: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    reportId: r.reportId,
    reportTitle: r.report.title,
    rangeLabel: r.rangeLabel,
    takenAt: r.takenAt.toISOString(),
    takenByName: r.takenBy?.name ?? null,
  }));
}

export async function getSnapshot(
  db: TxClient,
  organizationId: string,
  reportId: string,
  id: string,
): Promise<SnapshotSummary & { data: SnapshotData }> {
  const r = await db.reportSnapshot.findFirst({
    where: { organizationId, reportId, id },
    select: {
      id: true,
      reportId: true,
      rangeLabel: true,
      takenAt: true,
      data: true,
      takenBy: { select: { name: true } },
      report: { select: { title: true } },
    },
  });
  if (!r) throw new NotFoundError();
  return {
    id: r.id,
    reportId: r.reportId,
    reportTitle: r.report.title,
    rangeLabel: r.rangeLabel,
    takenAt: r.takenAt.toISOString(),
    takenByName: r.takenBy?.name ?? null,
    data: r.data as unknown as SnapshotData,
  };
}
