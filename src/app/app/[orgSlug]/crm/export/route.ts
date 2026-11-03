import { strToU8, zipSync, type Zippable } from "fflate";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/session";
import { csvContentDisposition } from "@/lib/csv";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CrmError, requireCrm } from "@/server/crm/access";
import { exportCsv, type ExportKind } from "@/server/crm/export";
import { withOrgTx, withUserTx } from "@/server/db/context";

/**
 * CSV export of the CRM (docs/features/crm.md: "Export to CSV anytime",
 * timeline included): ?kind=people | companies | items (&pipeline=) |
 * timeline, or ?kind=all (CRM settings > Import and export): people,
 * companies and each pipeline's deals as one zip, the timeline too with
 * &notes=1. Read as the viewer through RLS, so OWN access exports only
 * what the member can see. Formula-safe (src/lib/csv.ts) and rate-limited.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const KINDS: readonly ExportKind[] = ["people", "companies", "items", "timeline"];

export async function GET(request: Request, ctx: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse("Sign in again.", { status: 401 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as ExportKind | "all" | null;
  if (!kind || (kind !== "all" && !KINDS.includes(kind))) return new NextResponse("Pick what to export.", { status: 400 });
  const resolved = await withUserTx(user.id, ({ db }) =>
    db.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`,
  );
  const orgId = resolved[0]?.organizationId;
  if (!orgId) return new NextResponse("Not found", { status: 404 });
  const limit = await checkRateLimit(rateLimitKey("crm-export", user.id), 30, 3600);
  if (!limit.allowed) return new NextResponse("Too many exports. Try again later.", { status: 429 });
  if (kind === "all") {
    try {
      const files = await withOrgTx(orgId, async (octx) => {
        await requireCrm(octx);
        const zip: Zippable = {};
        const add = (name: string, csv: string) => {
          zip[name] = strToU8(csv);
        };
        add("people.csv", (await exportCsv(octx.db, orgId, "people")).csv);
        add("companies.csv", (await exportCsv(octx.db, orgId, "companies")).csv);
        const pipelines = await octx.db.crmPipeline.findMany({
          where: { organizationId: orgId, archivedAt: null },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        });
        const used = new Set<string>();
        for (const p of pipelines) {
          const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deals";
          let name = `deals-${base}.csv`;
          for (let i = 2; used.has(name); i++) name = `deals-${base}-${i}.csv`;
          used.add(name);
          add(name, (await exportCsv(octx.db, orgId, "items", { pipelineId: p.id })).csv);
        }
        if (url.searchParams.get("notes") === "1") add("timeline.csv", (await exportCsv(octx.db, orgId, "timeline")).csv);
        return zip;
      });
      const day = new Date().toISOString().slice(0, 10);
      return new NextResponse(Buffer.from(zipSync(files)), {
        headers: {
          "Content-Type": "application/zip",
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="crm-${day}.zip"`,
        },
      });
    } catch (error) {
      if (error instanceof CrmError) return new NextResponse(error.message, { status: 403 });
      throw error;
    }
  }
  try {
    const out = await withOrgTx(orgId, async (octx) => {
      await requireCrm(octx);
      return exportCsv(octx.db, orgId, kind, { pipelineId: url.searchParams.get("pipeline") });
    });
    return new NextResponse(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": csvContentDisposition(out.fileName),
      },
    });
  } catch (error) {
    if (error instanceof CrmError) return new NextResponse(error.message, { status: 403 });
    throw error;
  }
}
