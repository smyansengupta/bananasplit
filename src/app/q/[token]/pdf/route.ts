import { NextResponse } from "next/server";

import { contentDisposition } from "@/lib/http/content-disposition";
import { parsePublicToken } from "@/lib/crm/quotes";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { renderQuotePdf } from "@/server/crm/quote-pdf";
import { hashQuoteToken, quoteForPdf } from "@/server/crm/quotes";
import { withSystemOrgTx } from "@/server/db/context";

/** The PDF behind a public quote link: the token is checked by its hash in its own organization. */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request, ctx: RouteContext<"/q/[token]/pdf">) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw);
  const parsed = parsePublicToken(token);
  if (!parsed) return new NextResponse("Not found", { status: 404 });
  const ip = clientIpFrom(request.headers);
  const limit = await checkRateLimit(rateLimitKey("crm-quote-public-pdf", ip), 30, 600);
  if (!limit.allowed) return new NextResponse("Too many downloads. Try again in a few minutes.", { status: 429 });
  const input = await withSystemOrgTx(parsed.orgId, ({ db }) =>
    quoteForPdf(db, parsed.orgId, { publicTokenHash: hashQuoteToken(token) }),
  );
  if (!input) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderQuotePdf(input);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("attachment", `${input.number} ${input.title}.pdf`),
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
