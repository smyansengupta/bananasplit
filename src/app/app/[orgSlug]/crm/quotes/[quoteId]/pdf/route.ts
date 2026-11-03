import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { contentDisposition } from "@/lib/http/content-disposition";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CrmError, requireCrm } from "@/server/crm/access";
import { renderQuotePdf } from "@/server/crm/quote-pdf";
import { quoteForPdf } from "@/server/crm/quotes";
import { withOrgTx, withUserTx } from "@/server/db/context";

/**
 * GET /app/{orgSlug}/crm/quotes/{quoteId}/pdf: the quote or invoice as a
 * PDF, for a member who can see it (read as them, through RLS), rendered
 * after the transaction closes.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, ctx: RouteContext<"/app/[orgSlug]/crm/quotes/[quoteId]/pdf">) {
  const { orgSlug, quoteId } = await ctx.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const orgId = await withUserTx(session.user.id, async ({ db }) => {
    const rows = await db.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`;
    return rows[0]?.organizationId ?? null;
  });
  if (!orgId) return new NextResponse("Not found", { status: 404 });
  const limit = await checkRateLimit(rateLimitKey("crm-quote-pdf", session.user.id), 60, 600);
  if (!limit.allowed) return new NextResponse("Too many downloads. Try again in a few minutes.", { status: 429 });
  let input;
  try {
    input = await withOrgTx(orgId, async (octx) => {
      await requireCrm(octx);
      return quoteForPdf(octx.db, orgId, { id: quoteId });
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof CrmError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
  if (!input) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderQuotePdf(input);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("inline", `${input.number} ${input.title}.pdf`),
      "Cache-Control": "private, no-store",
    },
  });
}
