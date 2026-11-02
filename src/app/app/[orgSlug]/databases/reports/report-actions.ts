"use server";

import { refresh } from "next/cache";

import type { ReportAccess } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can, requirePermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import type { BoardWidget } from "@/lib/boards";
import { readInsights as builtInInsights, spanPhrase } from "@/lib/reports/compute";
import {
  fillRows,
  newWidget,
  suggestedWidgets,
  type ReportWidget,
  type WidgetConfig,
} from "@/lib/reports/catalog";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { resolveAiCredentials } from "@/server/ai/connections";
import { AiImportError } from "@/server/ai/generate";
import { withOrgAction } from "@/server/db/context";
import type { RangeParams } from "@/server/reports/range";
import {
  answerAboutReports,
  builtInInsights as eventsInsights,
  loadBuiltInReports,
  reportViewer,
  runReport,
  writeInsights,
} from "@/server/reports/run";
import {
  ReportInputError,
  archiveReport,
  canEditReport,
  createReport,
  getReport,
  listReports,
  restoreReport,
  saveInsights,
  saveReportLayout,
  saveSchedule,
  saveWidgetConfig,
  takeSnapshot,
  updateReportDetails,
  type CreateReportInput,
} from "@/server/reports/saved";
import { listSources } from "@/server/reports/sources";

/**
 * Saved reports' actions (Databases > Reports). Each one runs as the member,
 * so RLS decides what they can read and change; the service layer
 * (src/server/reports/saved.ts) says no in a sentence first.
 */

export type ReportResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const reportsAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { ...options, feature: "reports" });

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ReportInputError) return { ok: false, error: error.message };
  if (error instanceof NotFoundError)
    return { ok: false, error: "That report isn't there any more." };
  if (error instanceof ForbiddenError) {
    return {
      ok: false,
      error: "Only whoever made this report, or an owner or admin, can change it.",
    };
  }
  throw error;
}

export async function createReportAction(
  organizationId: string,
  input: CreateReportInput,
): Promise<ReportResult<{ id: string }>> {
  try {
    const id = await reportsAction(async (ctx) => {
      requirePermission(ctx, "reports.view");
      return createReport(await reportViewer(ctx), input);
    })(organizationId);
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}

/** One click from Reports home: a database's suggested widgets, under its name. */
export async function createSuggestedReport(
  organizationId: string,
  sourceKey: string,
): Promise<ReportResult<{ id: string }>> {
  try {
    const id = await reportsAction(async (ctx) => {
      requirePermission(ctx, "reports.view");
      const v = await reportViewer(ctx);
      const source = (await listSources(v)).find((s) => s.key === sourceKey);
      if (!source) throw new ReportInputError("That database isn't there, or you can't see it.");
      const widgets: ReportWidget[] = [];
      for (const type of suggestedWidgets(source, can(ctx, "databases.write"))) {
        widgets.push(newWidget(type, source, widgets));
      }
      return createReport(v, {
        title: source.name,
        source: source.key,
        access: "ORGANIZATION",
        widgets: fillRows(widgets),
      });
    })(organizationId);
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveReportLayoutAction(
  organizationId: string,
  reportId: string,
  layout: BoardWidget[] | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await reportsAction(async (ctx) => saveReportLayout(await reportViewer(ctx), reportId, layout))(
      organizationId,
    );
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function saveWidgetConfigAction(
  organizationId: string,
  reportId: string,
  widgetId: string,
  config: WidgetConfig,
): Promise<ReportResult> {
  try {
    await reportsAction(async (ctx) =>
      saveWidgetConfig(await reportViewer(ctx), reportId, widgetId, config),
    )(organizationId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateReportAction(
  organizationId: string,
  reportId: string,
  input: { title?: string; access?: ReportAccess },
): Promise<ReportResult> {
  try {
    await reportsAction(async (ctx) =>
      updateReportDetails(await reportViewer(ctx), reportId, input),
    )(organizationId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** When the report emails itself (null stops it). */
export async function saveScheduleAction(
  organizationId: string,
  reportId: string,
  schedule: unknown,
): Promise<ReportResult> {
  try {
    await reportsAction(async (ctx) => saveSchedule(await reportViewer(ctx), reportId, schedule))(
      organizationId,
    );
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreReportAction(
  organizationId: string,
  reportId: string,
): Promise<ReportResult> {
  try {
    await reportsAction(async (ctx) => restoreReport(await reportViewer(ctx), reportId))(
      organizationId,
    );
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveReportAction(
  organizationId: string,
  reportId: string,
): Promise<ReportResult> {
  try {
    await reportsAction(async (ctx) => archiveReport(await reportViewer(ctx), reportId))(
      organizationId,
    );
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

const COPIES_PER_HOUR = 20;

/** Freezes the report as it reads over `range`, as this person sees it (theirs and admins' to open). */
export async function takeSnapshotAction(
  organizationId: string,
  reportId: string,
  range: RangeParams,
): Promise<ReportResult<{ id: string }>> {
  const user = await requireUser();
  const hit = await checkRateLimit(
    rateLimitKey("report-copy", organizationId, user.id),
    COPIES_PER_HOUR,
    60 * 60,
  );
  if (!hit.allowed) {
    return { ok: false, error: `That's a lot of copies. Try again ${retryAfterText(hit)}.` };
  }
  try {
    const id = await reportsAction(async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, organizationId, reportId);
      const run = await runReport(v, report, range);
      if (!run.source) throw new ReportInputError("You can't see this report's database any more.");
      return takeSnapshot(
        v,
        report,
        run.source.name,
        run.range.span ?? run.range.label,
        run.computed,
      );
    })(organizationId);
    refresh();
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}

const INSIGHTS_PER_MEMBER_PER_HOUR = 20;
const INSIGHTS_PER_ORG_PER_HOUR = 120;

/**
 * Insights' Ask Claude: the report's numbers go to the organization's
 * connected model (no network inside a transaction, so: read, ask, save),
 * and its sentences are kept on the report for everyone who opens it.
 */
export async function askClaudeAction(
  organizationId: string,
  reportId: string,
  range: RangeParams,
): Promise<ReportResult> {
  let read;
  try {
    read = await reportsAction(async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, organizationId, reportId);
      // Claude's reading is kept on the report, so only its editors may ask.
      if (!canEditReport(report, ctx.userId, ctx.role)) {
        throw new ReportInputError(
          "Only whoever made this report, or an owner or admin, can ask Claude about it.",
        );
      }
      const run = await runReport(v, { ...report, insights: null }, range);
      if (!run.source) throw new ReportInputError("You can't see this report's database any more.");
      const settings = await ctx.db.orgSettings.findUnique({
        where: { organizationId },
        select: { reportsDataVersion: true, reportsRefreshSeconds: true, updatedAt: true },
      });
      return { report, run, role: ctx.role, tz: v.tz, settings };
    })(organizationId);
  } catch (error) {
    return failure(error);
  }
  // Charged only once the member is known to be able to ask.
  const user = await requireUser();
  for (const [key, limit] of [
    [rateLimitKey("report-insights-member", organizationId, user.id), INSIGHTS_PER_MEMBER_PER_HOUR],
    [rateLimitKey("report-insights-org", organizationId), INSIGHTS_PER_ORG_PER_HOUR],
  ] as const) {
    const hit = await checkRateLimit(key, limit, 60 * 60);
    if (!hit.allowed)
      return {
        ok: false,
        error: `Claude has read this a lot this hour. Try again ${retryAfterText(hit)}.`,
      };
  }
  const creds = await resolveAiCredentials(organizationId, null);
  if (!creds) {
    return {
      ok: false,
      error:
        "No AI model is connected yet. An owner or admin can connect one in Admin panel › Integrations.",
    };
  }
  const types = new Set(read.run.computed.map((c) => c.widget.type));
  const builtIn = await loadBuiltInReports({
    orgId: organizationId,
    role: read.role,
    tz: read.tz,
    range: read.run.range,
    settings: read.settings,
    want: { attendance: types.has("attendance"), retention: types.has("retention") },
  });
  const ids = (type: string) => read.run.computed.find((c) => c.widget.type === type)?.widget.id;
  let lines;
  try {
    lines = await writeInsights(creds, {
      builtIn,
      title: read.report.title,
      sourceName: read.run.source!.name,
      range: read.run.range,
      computed: read.run.computed,
      fallback: [
        ...eventsInsights(
          builtIn.attendance,
          builtIn.retention,
          {
            attendance: ids("attendance"),
            retention: ids("retention"),
          },
          spanPhrase(read.run.range),
        ),
        ...builtInInsights(read.run.computed, read.run.range),
      ].slice(0, 5),
    });
  } catch (error) {
    if (error instanceof AiImportError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    await reportsAction(async (ctx) =>
      saveInsights(await reportViewer(ctx), reportId, lines, read.run.range),
    )(organizationId);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}

const ASK_PER_MEMBER_PER_HOUR = 30;

/**
 * Reports home's "Ask about your reports": every report the member can see,
 * computed as them, goes to the organization's model as data with their
 * question, and a short answer comes back. Nothing is kept.
 */
export async function askReportsAction(
  organizationId: string,
  question: string,
  range: RangeParams,
  /** One report's own "Ask about this report"; else every report. */
  reportId?: string,
): Promise<ReportResult<{ answer: string }>> {
  const asked = question.trim().slice(0, 500);
  if (!asked) return { ok: false, error: "Ask a question first." };
  const user = await requireUser();
  const orgHit = await checkRateLimit(
    rateLimitKey("reports-ask-org", organizationId),
    120,
    60 * 60,
  );
  if (!orgHit.allowed) {
    return {
      ok: false,
      error: `Your organization has asked a lot this hour. Try again ${retryAfterText(orgHit)}.`,
    };
  }
  const hit = await checkRateLimit(
    rateLimitKey("reports-ask", organizationId, user.id),
    ASK_PER_MEMBER_PER_HOUR,
    60 * 60,
  );
  if (!hit.allowed)
    return { ok: false, error: `That's a lot of questions. Try again ${retryAfterText(hit)}.` };
  let reports;
  try {
    reports = await reportsAction(async (ctx) => {
      const v = await reportViewer(ctx);
      const out = [];
      const all = await listReports(ctx.db, organizationId);
      const picked = reportId ? all.filter((r) => r.id === reportId) : all.slice(0, 12);
      for (const report of picked) {
        const run = await runReport(v, report, range);
        if (run.source) out.push({ title: report.title, source: run.source.name, run });
      }
      return out;
    })(organizationId);
  } catch (error) {
    return failure(error);
  }
  if (reports.length === 0) {
    return {
      ok: false,
      error: reportId ? "You can't open this report." : "Make a report first, then ask about it.",
    };
  }
  const creds = await resolveAiCredentials(organizationId, null);
  if (!creds) {
    return {
      ok: false,
      error:
        "No AI model is connected yet. An owner or admin can connect one in Admin panel › Integrations.",
    };
  }
  try {
    const answer = await answerAboutReports(creds, asked, reports);
    return { ok: true, answer };
  } catch (error) {
    if (error instanceof AiImportError) return { ok: false, error: error.message };
    throw error;
  }
}
