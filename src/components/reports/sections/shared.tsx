import { getReport, type ReportKey } from "@/server/reports/cache";
import type { LinkRange } from "@/server/reports/links";
import type { ReportId, ReportResult } from "@/server/reports/types";

/**
 * What every report section needs, computed once by the page after it has
 * authorized the viewer: the cache key (org, tier, explicit dates, tz, data
 * version, settings stamp), the refresh interval, and what the deep links
 * and labels need.
 */
export interface ReportViewContext {
  key: ReportKey;
  refreshSeconds: number;
  slug: string;
  tz: string;
  link: LinkRange;
  /** "Fall 2026", "Last 30 days", "All time", ... */
  rangeLabel: string;
}

/** Loads one report; a failure is logged and returned as null so only that card degrades. */
export async function loadReport<Id extends ReportId>(
  id: Id,
  ctx: ReportViewContext,
): Promise<ReportResult<Id> | null> {
  try {
    return await getReport(id, ctx.key, ctx.refreshSeconds);
  } catch (error) {
    console.error(`[reports] ${id} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}
