import type { Prisma } from "@/generated/prisma/client";
import { ME } from "@/lib/crm/templates";
import { suggestedLayout } from "@/lib/reports/catalog";
import { reportViewer } from "@/server/reports/run";
import { createReport } from "@/server/reports/saved";
import { listSources } from "@/server/reports/sources";
import type { TxClient } from "@/server/db/context";

import type { CrmActor } from "./access";

/**
 * What setup makes for each pipeline beyond the pipeline itself
 * (docs/features/crm.md, "Organization setup in one step"): its saved
 * views (Stuck, No next step, Mine, Best scores) and a starter report on
 * its database with the pipeline widgets (velocity, conversion, time in
 * stage, sources, goals), plus one Outreach report on People. Run again,
 * it adds only what's missing. A report that can't be made (the
 * organization is at its report limit) is skipped, never failing setup.
 */

const PIPELINE_VIEWS: { name: string; filters: { col: string; op: string; value: string }[] }[] = [
  { name: "Stuck", filters: [{ col: "flag", op: "eq", value: "stuck" }] },
  { name: "No next step", filters: [{ col: "flag", op: "eq", value: "nostep" }] },
  { name: "Mine", filters: [{ col: "owner", op: "eq", value: ME }] },
  { name: "Best scores", filters: [{ col: "sort", op: "eq", value: "score" }] },
];

export async function ensurePipelineViews(actor: CrmActor): Promise<number> {
  const { db, organizationId, userId } = actor;
  const pipelines = await db.crmPipeline.findMany({ where: { organizationId, archivedAt: null }, select: { id: true } });
  const have = await db.crmView.findMany({
    where: { organizationId, objectKind: "deals", pipelineId: { not: null } },
    select: { pipelineId: true, name: true },
  });
  let made = 0;
  for (const p of pipelines) {
    for (const v of PIPELINE_VIEWS) {
      if (have.some((h) => h.pipelineId === p.id && h.name === v.name)) continue;
      await db.crmView.create({
        data: {
          organizationId,
          objectKind: "deals",
          pipelineId: p.id,
          name: v.name,
          filters: v.filters as unknown as Prisma.InputJsonArray,
          shared: true,
          createdById: userId,
        },
      });
      made++;
    }
  }
  return made;
}

/** A pipeline's saved views as links on its board (the board reads them as its own URL parameters). */
export async function pipelineViews(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  base: string,
  current: URLSearchParams,
  viewerId: string,
): Promise<{ name: string; href: string; active: boolean }[]> {
  const rows = await db.crmView.findMany({
    where: { organizationId, objectKind: "deals", pipelineId },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: { name: true, filters: true },
  });
  return rows.map((r) => {
    const params = new URLSearchParams();
    for (const f of (Array.isArray(r.filters) ? r.filters : []) as { col?: string; value?: string }[]) {
      if (f.col === "flag" || f.col === "sort") params.set(f.col, String(f.value ?? ""));
      if (f.col === "owner") params.set("owner", f.value === ME ? "me" : String(f.value ?? viewerId));
      if (f.col === "closed") params.set("closed", "1");
    }
    const active = [...params.entries()].every(([k, v]) => current.get(k) === v) && params.size > 0;
    return { name: r.name, href: `${base}?${params.toString()}`, active };
  });
}

/** One starter report per pipeline, and an Outreach report on People. */
export async function ensureStarterReports(actor: CrmActor): Promise<number> {
  const { db, organizationId } = actor;
  const v = await reportViewer(actor);
  const sources = (await listSources(v)).filter((s) => s.crm && (s.crm.kind === "pipeline" || s.crm.kind === "people"));
  const existing = await db.report.findMany({
    where: { organizationId, source: { in: sources.map((s) => s.key) } },
    select: { source: true },
  });
  let made = 0;
  for (const s of sources) {
    if (existing.some((e) => e.source === s.key)) continue;
    const widgets = suggestedLayout(s, true).filter((w) => w.type !== "health");
    await db.$executeRaw`SAVEPOINT crm_starter_report`;
    try {
      await createReport(v, {
        title: s.crm!.kind === "people" ? "Outreach" : `${s.name} report`,
        source: s.key,
        access: "ORGANIZATION",
        widgets,
      });
      await db.$executeRaw`RELEASE SAVEPOINT crm_starter_report`;
      made++;
    } catch {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT crm_starter_report`;
    }
  }
  return made;
}
