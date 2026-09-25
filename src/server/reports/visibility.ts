import { Prisma } from "@/generated/prisma/client";
import type { DatabaseKind } from "@/generated/prisma/enums";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { REPORT_SOURCE_KINDS, REPORTS } from "./registry";
import { REPORT_IDS, type ReportId, type ReportTier } from "./types";

/**
 * Which reports a tier may see: a report is shown only when every database
 * it reads is visible to the tier (DatabaseDefinition.memberVisibility, the
 * same app.can_view_rows the RLS policies use; TREASURER counts as MEMBER).
 * A hidden report is neither computed nor rendered.
 *
 * Not cached: it is one small statement per page view, so tightening a
 * database's visibility in Settings > Privacy hides the report on the very
 * next request, whatever is in the report cache.
 */
export async function queryDatabaseVisibility(
  db: TxClient,
  orgId: string,
  tier: ReportTier,
  kinds: readonly DatabaseKind[] = REPORT_SOURCE_KINDS,
): Promise<Partial<Record<DatabaseKind, boolean>>> {
  if (kinds.length === 0) return {};
  const rows = await db.$queryRaw<{ kind: DatabaseKind; visible: boolean }[]>`
    SELECT k.kind, app.can_view_rows(${orgId}, k.kind, ${tier}) AS visible
      FROM unnest(ARRAY[${Prisma.join([...kinds])}]::text[]) AS k(kind)`;
  return Object.fromEntries(rows.map((r) => [r.kind, r.visible === true]));
}

/** The reports whose every source is visible, in page order. */
export function visibleReportIds(visibility: Partial<Record<DatabaseKind, boolean>>): ReportId[] {
  return REPORT_IDS.filter((id) => REPORTS[id].sources.every((kind) => visibility[kind] === true));
}

/**
 * The visible reports for `tier` in `orgId`. AUTHORIZE FIRST: the caller has
 * established membership (getOrgContextBySlug) and derived the tier from it.
 */
export async function getVisibleReports(orgId: string, tier: ReportTier): Promise<ReportId[]> {
  const visibility = await withSystemOrgTx(orgId, ({ db }) => queryDatabaseVisibility(db, orgId, tier));
  return visibleReportIds(visibility);
}
