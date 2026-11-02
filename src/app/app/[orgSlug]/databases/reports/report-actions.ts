"use server";

import { refresh } from "next/cache";

import type { ReportAccess } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can, requirePermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import type { BoardWidget } from "@/lib/boards";
import { readInsights as builtInInsights } from "@/lib/reports/compute";
import {
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
import { reportViewer, runReport, writeInsights } from "@/server/reports/run";
import {
  ReportInputError,
  archiveReport,
  createReport,
  getReport,
  saveInsights,
  saveReportLayout,
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
  if (error instanceof ForbiddenError) return { ok: false, error: "You can't do that here." };
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
        widgets,
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

/** Freezes the report as it reads over `range`, for Past reports. */
export async function takeSnapshotAction(
  organizationId: string,
  reportId: string,
  range: RangeParams,
): Promise<ReportResult<{ id: string }>> {
  try {
    const id = await reportsAction(async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, organizationId, reportId);
      const run = await runReport(v, report, range);
      if (!run.source) throw new ReportInputError("You can't see this report's database any more.");
      return takeSnapshot(v, report, run.source.name, run.range.label, run.computed);
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
  let read;
  try {
    read = await reportsAction(async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, organizationId, reportId);
      const run = await runReport(v, { ...report, insights: null }, range);
      if (!run.source) throw new ReportInputError("You can't see this report's database any more.");
      return { report, run };
    })(organizationId);
  } catch (error) {
    return failure(error);
  }
  const creds = await resolveAiCredentials(organizationId, null);
  if (!creds) {
    return {
      ok: false,
      error:
        "No AI model is connected yet. An owner or admin can connect one in Admin panel › Integrations.",
    };
  }
  let lines;
  try {
    lines = await writeInsights(creds, {
      title: read.report.title,
      sourceName: read.run.source!.name,
      range: read.run.range,
      computed: read.run.computed,
      fallback: builtInInsights(read.run.computed, read.run.range),
    });
  } catch (error) {
    if (error instanceof AiImportError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    await reportsAction(async (ctx) => saveInsights(await reportViewer(ctx), reportId, lines))(
      organizationId,
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}
