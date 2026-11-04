import { readWidgets } from "@/lib/reports/catalog";
import { isReadyReport, readyKindsFor, readyReport, type ReadyKind, type ReadyReport } from "@/lib/reports/crm-ready";

import { createReport } from "./saved";
import { listSources, type SourceViewer } from "./sources";

/**
 * The CRM's ready-made reports (src/lib/reports/crm-ready.ts) as saved
 * reports: made for the organization when the CRM is set up (starter.ts),
 * offered on Reports home until they're made, and opened by the CRM's
 * Report buttons, which make one the first time when there's none.
 */

/** A title no other live report has: "Outreach", else "Outreach overview". */
function freeTitle(title: string, taken: ReadonlySet<string>): string {
  if (!taken.has(title.toLowerCase())) return title;
  const other = `${title} overview`;
  return taken.has(other.toLowerCase()) ? `${title} (CRM)` : other;
}

/** Every live report (for their titles), and the archived ones on `sources` when asked. */
async function reportsOn(v: SourceViewer, sources: readonly string[], archived: boolean) {
  const rows = await v.db.report.findMany({
    where: { organizationId: v.organizationId, ...(archived ? {} : { archivedAt: null }) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, source: true, widgets: true, archivedAt: true },
  });
  return rows
    .filter((r) => sources.includes(r.source) || r.archivedAt === null)
    .map((r) => ({ ...r, widgets: readWidgets(r.widgets) }));
}

async function make(v: SourceViewer, ready: ReadyReport, taken: Set<string>): Promise<string> {
  const title = freeTitle(ready.title, taken);
  const made = await createReport(v, {
    title,
    source: ready.source,
    access: "ORGANIZATION",
    widgets: ready.widgets,
  });
  taken.add(title.toLowerCase());
  return made.id;
}

/**
 * Every ready-made report the CRM's databases offer, made once each: one
 * already there (archived ones too, so nothing put away comes back) is
 * left alone. A report that can't be made (the organization is at its
 * report limit) is skipped. Returns how many were made.
 */
export async function ensureReadyReports(v: SourceViewer): Promise<number> {
  const offered = (await listSources(v)).flatMap((s) => readyKindsFor(s).map((k) => readyReport(k, s)));
  if (offered.length === 0) return 0;
  const all = await reportsOn(
    v,
    offered.map((r) => r.source),
    true,
  );
  const taken = new Set(all.filter((r) => r.archivedAt === null).map((r) => r.title.toLowerCase()));
  let made = 0;
  for (const ready of offered) {
    if (all.some((r) => isReadyReport(r, ready.kind, ready.source))) continue;
    await v.db.$executeRaw`SAVEPOINT crm_ready_report`;
    try {
      await make(v, ready, taken);
      await v.db.$executeRaw`RELEASE SAVEPOINT crm_ready_report`;
      made++;
    } catch {
      await v.db.$executeRaw`ROLLBACK TO SAVEPOINT crm_ready_report`;
    }
  }
  return made;
}

/** The ready-made reports not made yet (no live one the viewer sees), for Reports home. */
export async function missingReadyReports(v: SourceViewer): Promise<ReadyReport[]> {
  const offered = (await listSources(v)).flatMap((s) => readyKindsFor(s).map((k) => readyReport(k, s)));
  if (offered.length === 0) return [];
  const live = await reportsOn(
    v,
    offered.map((r) => r.source),
    false,
  );
  return offered.filter((ready) => !live.some((r) => isReadyReport(r, ready.kind, ready.source)));
}

/**
 * The live ready-made report of `kind` on `sourceKey` the viewer sees, the
 * most recently changed; with `make`, one is made when there's none. Null
 * when the database isn't one the viewer can report on.
 */
export async function readyReportId(
  v: SourceViewer,
  kind: ReadyKind,
  sourceKey: string,
  options: { make: boolean },
): Promise<string | null> {
  const source = (await listSources(v)).find((s) => s.key === sourceKey);
  if (!source || !readyKindsFor(source).includes(kind)) return null;
  if (options.make) {
    // Two clicks at once make one report, not two.
    const lock = `ready-report:${v.organizationId}:${kind}:${sourceKey}`;
    await v.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
  }
  const live = await reportsOn(v, [sourceKey], false);
  const found = live.find((r) => isReadyReport(r, kind, sourceKey));
  if (found) return found.id;
  if (!options.make) return null;
  return make(v, readyReport(kind, source), new Set(live.map((r) => r.title.toLowerCase())));
}
