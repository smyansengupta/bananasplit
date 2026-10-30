import { SHOT_IMAGE_TYPES, type ShotImageType } from "@/lib/ai/calendar-shot";
import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { sniffMimeType } from "@/lib/finance/file-sniff";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { resolveAiCredentials } from "@/server/ai/connections";
import { readFinanceDocument } from "@/server/ai/finance-import";
import { AiImportError } from "@/server/ai/generate";
import { auditAiRead } from "@/server/ai/route-context";
import { withOrgTx } from "@/server/db/context";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";
import { getCategoryOptions } from "@/app/app/[orgSlug]/finance/queries";

/**
 * POST /api/orgs/{orgId}/ai/receipt-read
 *
 * Any member asking to be paid back: the club's connected AI model reads the
 * receipt they are attaching and fills in the request (amount, date, what
 * it was for, where, and a category from the active budget). It reads ONLY
 * the file in this request, from the person sending it: nothing is stored,
 * nothing is created, and no one else's receipt is reachable from here (the
 * finance import route, which reads the club's records, stays finance-only).
 * The member checks the fields and sends the request themselves.
 *
 * Multipart `file`: a PDF or a picture (PNG, JPEG, WebP, GIF), checked by its
 * bytes. Rate-limited per member and against the club's shared AI budget;
 * audited with sizes only, never the content.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_MEMBER_PER_HOUR = 15;
const PER_CLUB_PER_HOUR = 120;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export interface ReceiptReadResult {
  /** Plain decimal, like "12.50"; null when the model couldn't read one. */
  amount: string | null;
  /** YYYY-MM-DD. */
  date: string | null;
  description: string | null;
  counterparty: string | null;
  /** One of the active budget's category names when it fits. */
  category: string | null;
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first." });

  let context: { today: string; timezone: string; categories: string[] };
  try {
    context = await withOrgTx(orgId, async ({ db }) => {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { timezone: true },
      });
      const active = await db.budgetPeriod.findFirst({
        where: { organizationId: orgId, isActive: true },
        select: { id: true },
      });
      const options = active ? await getCategoryOptions(db, [active]) : [];
      const timezone = safeTimeZone(org.timezone);
      return {
        timezone,
        today: zonedDateKey(new Date(), timezone),
        categories: options.map((c) => c.name),
      };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }

  for (const [key, limit] of [
    [rateLimitKey("ai-receipt-member", orgId, session.user.id), PER_MEMBER_PER_HOUR],
    [rateLimitKey("ai-import-club", orgId), PER_CLUB_PER_HOUR],
  ] as const) {
    const hit = await checkRateLimit(key, limit, 60 * 60);
    if (!hit.allowed) {
      return json(429, {
        error: `Too many receipts read for now. Try again ${retryAfterText(hit)}.`,
      });
    }
  }

  const upload = await readUpload(request).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;
  const type = sniffMimeType(upload.file.bytes);
  const isImage = type !== null && (SHOT_IMAGE_TYPES as readonly string[]).includes(type);
  if (type !== "application/pdf" && !isImage) {
    return json(415, { error: "Use a photo or a PDF of the receipt." });
  }
  // No AI connected is not an error for the person filling the form: they
  // just type it in. The client treats `filled: false` as "nothing read".
  const creds = await resolveAiCredentials(orgId, undefined);
  if (!creds) return json(200, { filled: false });

  try {
    const base64 = upload.file.bytes.toString("base64");
    const { result, model } = await readFinanceDocument({
      creds,
      ...(isImage
        ? { image: { mediaType: type as ShotImageType, base64 } }
        : {
            document: {
              mediaType: "application/pdf" as const,
              base64,
              fileName: upload.file.filename || "receipt.pdf",
            },
          }),
      today: context.today,
      timezone: context.timezone,
      categories: context.categories,
    });
    await auditAiRead(orgId, "ai.finance_import_read", {
      connection: creds.id,
      model,
      mode: "receipt",
      bytes: upload.file.bytes.length,
      records: result.rows.length,
    });
    // A receipt is one purchase: the first money-out line (or the first line).
    const row = result.rows.find((r) => r.direction === "OUT") ?? result.rows[0];
    if (!row) return json(200, { filled: false });
    const known = context.categories.find(
      (c) => row.category && c.toLowerCase() === row.category.trim().toLowerCase(),
    );
    const read: ReceiptReadResult = {
      amount: row.amountCents ? (row.amountCents / 100).toFixed(2) : null,
      date: row.date,
      description: row.description?.trim() || null,
      counterparty: row.counterparty?.trim() || null,
      category: known ?? null,
    };
    return json(200, { filled: true, ...read });
  } catch (error) {
    if (error instanceof AiImportError) return json(200, { filled: false, note: error.message });
    throw error;
  }
}
