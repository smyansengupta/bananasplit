import { NotFoundError } from "@/lib/auth/errors";
import { withOrgTxAs } from "@/server/db/context";

import { reportViewer, runReport } from "./run";
import { getReport } from "./saved";

/**
 * A report shared outside the organization (/r/{token}, /r/invite/{id}),
 * computed as its MAKER sees it now, over its default range: the same as
 * the copy a scheduled send keeps, so a shared view never shows a row its
 * maker can't open. The caller (src/server/reports/shared-view.ts) has
 * already found the report by its link's token or a matching invite, on
 * the service path, and passes the maker it read there; this acts only as
 * that maker, and only for a live report the organization shares. A maker
 * who has left the organization shares nothing.
 */
export async function runSharedReportAsMaker(
  organizationId: string,
  reportId: string,
  makerId: string,
): Promise<{
  title: string;
  sourceName: string;
  rangeLabel: string;
  computed: Awaited<ReturnType<typeof runReport>>["computed"];
} | null> {
  try {
    return await withOrgTxAs(makerId, organizationId, async (ctx) => {
      const v = await reportViewer(ctx);
      const report = await getReport(ctx.db, organizationId, reportId);
      if (report.createdById !== makerId || report.access !== "ORGANIZATION") return null;
      const result = await runReport(v, report, {});
      if (!result.source) return null;
      return {
        title: report.title,
        sourceName: result.source.name,
        rangeLabel: result.range.label,
        computed: result.computed,
      };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
