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
 * timeline, and &ids= (comma-separated) for only the picked people or
 * companies. Read as the viewer through RLS, so OWN access exports only
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
  const kind = url.searchParams.get("kind") as ExportKind | null;
  if (!kind || !KINDS.includes(kind)) return new NextResponse("Pick what to export.", { status: 400 });
  const resolved = await withUserTx(user.id, ({ db }) =>
    db.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`,
  );
  const orgId = resolved[0]?.organizationId;
  if (!orgId) return new NextResponse("Not found", { status: 404 });
  const limit = await checkRateLimit(rateLimitKey("crm-export", user.id), 30, 3600);
  if (!limit.allowed) return new NextResponse("Too many exports. Try again later.", { status: 429 });
  try {
    const out = await withOrgTx(orgId, async (octx) => {
      await requireCrm(octx);
      const ids = (url.searchParams.get("ids") ?? "")
        .split(",")
        .filter((v) => /^[A-Za-z0-9_-]{1,64}$/.test(v))
        .slice(0, 500);
      return exportCsv(octx.db, orgId, kind, { pipelineId: url.searchParams.get("pipeline"), ids });
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
