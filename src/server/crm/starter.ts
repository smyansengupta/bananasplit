import type { Prisma } from "@/generated/prisma/client";
import { ME } from "@/lib/crm/templates";
import { ensureReadyReports } from "@/server/reports/ready";
import { reportViewer } from "@/server/reports/run";
import type { TxClient } from "@/server/db/context";

import type { CrmActor } from "./access";

/**
 * What setup makes for each pipeline beyond the pipeline itself
 * (docs/features/crm.md, "Organization setup in one step"): its saved
 * views (Stuck, No next step, Mine, Best scores), and the CRM's
 * ready-made reports in Databases > Reports: Deals on each pipeline,
 * People and Outreach on People (src/lib/reports/crm-ready.ts). Run again,
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

/** The ready-made reports: Deals on each pipeline, People and Outreach on People. */
export async function ensureStarterReports(actor: CrmActor): Promise<number> {
  return ensureReadyReports(await reportViewer(actor));
}
