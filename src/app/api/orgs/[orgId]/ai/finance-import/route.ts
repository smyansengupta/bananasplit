import { z } from "zod";

import { MAX_IMPORT_TEXT, SheetSample } from "@/lib/ai/finance-sheet";
import { SHOT_IMAGE_TYPES, type ShotImageType } from "@/lib/ai/calendar-shot";
import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { sniffMimeType } from "@/lib/finance/file-sniff";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { resolveAiCredentials } from "@/server/ai/connections";
import { readFinanceDocument, readFinanceSheet } from "@/server/ai/finance-import";
import { AiImportError } from "@/server/ai/generate";
import { auditAiRead, loadFinanceImportContext } from "@/server/ai/route-context";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /api/orgs/{orgId}/ai/finance-import
 *
 * Owners and treasurers (finance.manage): the club's connected AI model
 * reads past money records.
 * - JSON `{ mode: "sheet", sample }`: a spreadsheet the browser parsed; the
 *   model sees a sample of rows and each text column's distinct values and
 *   says how the columns map (the browser maps every row).
 * - JSON `{ mode: "text", text }`: pasted records (a Venmo history, a
 *   statement copied as text); the model lists them.
 * - multipart `file` (PDF, PNG, JPEG, WebP or GIF, checked by its bytes):
 *   the model lists the records it shows.
 * Nothing is stored or created here: the treasurer reviews the proposal and
 * imports through importFinanceRecords. Rate-limited with the other AI
 * imports; audited with sizes only, never the content.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_MEMBER_PER_HOUR = 20;
const PER_CLUB_PER_HOUR = 120;
const MAX_JSON_BYTES = 300_000;

const jsonSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("sheet"), sample: SheetSample, connection: z.string().max(20).optional() }),
  z.object({
    mode: z.literal("text"),
    text: z
      .string()
      .trim()
      .min(1, "Paste some records first.")
      .max(MAX_IMPORT_TEXT, "That's too much text for one read. Split it into smaller parts, or upload the file."),
    connection: z.string().max(20).optional(),
  }),
]);

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const NO_CONNECTION = {
  error: "No AI model is connected yet. An owner or admin can connect one in Settings › Integrations.",
  code: "no-connection",
};

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first." });

  let ctx;
  try {
    ctx = await loadFinanceImportContext(orgId);
  } catch (error) {
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }
  if (!ctx.canManageFinance) {
    return json(403, { error: "Only the club's owners and treasurers can import finance records." });
  }

  const multipart = (request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
  let body: z.infer<typeof jsonSchema> | null = null;
  if (!multipart) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) {
      return json(413, { error: "That's too much for one read. Split it into smaller parts." });
    }
    const parsed = jsonSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Nothing to read." });
    body = parsed.data;
  }

  for (const [key, limit] of [
    [rateLimitKey("ai-import-member", orgId, session.user.id), PER_MEMBER_PER_HOUR],
    [rateLimitKey("ai-import-club", orgId), PER_CLUB_PER_HOUR],
  ] as const) {
    const hit = await checkRateLimit(key, limit, 60 * 60);
    if (!hit.allowed) return json(429, { error: `Too many AI imports for now. Try again ${retryAfterText(hit)}.` });
  }

  try {
    if (body?.mode === "sheet") {
      const creds = await resolveAiCredentials(orgId, body.connection);
      if (!creds) return json(409, NO_CONNECTION);
      const { result, model, label } = await readFinanceSheet({
        creds,
        sample: body.sample,
        today: ctx.today,
        categories: ctx.categories,
      });
      await auditAiRead(orgId, "ai.finance_import_read", {
        connection: creds.id,
        model,
        mode: "sheet",
        rows: body.sample.rows.length,
        values: body.sample.values.reduce((n, v) => n + v.values.length, 0),
        labels: result.labels.length,
      });
      return json(200, { ...result, readBy: label });
    }

    if (body?.mode === "text") {
      const creds = await resolveAiCredentials(orgId, body.connection);
      if (!creds) return json(409, NO_CONNECTION);
      const { result, model, label } = await readFinanceDocument({
        creds,
        text: body.text,
        today: ctx.today,
        timezone: ctx.timezone,
        categories: ctx.categories,
      });
      await auditAiRead(orgId, "ai.finance_import_read", {
        connection: creds.id,
        model,
        mode: "text",
        characters: body.text.length,
        records: result.rows.length + result.budget.length,
      });
      return json(200, { ...result, readBy: label });
    }

    const upload = await readUpload(request).catch(uploadErrorResponse);
    if (upload instanceof Response) return upload;
    const type = sniffMimeType(upload.file.bytes);
    const isImage = type !== null && (SHOT_IMAGE_TYPES as readonly string[]).includes(type);
    if (type !== "application/pdf" && !isImage) {
      return json(415, { error: "Upload a PDF or a picture (PNG, JPEG, WebP or GIF). Spreadsheets are read in your browser." });
    }
    const creds = await resolveAiCredentials(orgId, upload.fields.connection);
    if (!creds) return json(409, NO_CONNECTION);
    const base64 = upload.file.bytes.toString("base64");
    const { result, model, label } = await readFinanceDocument({
      creds,
      ...(isImage
        ? { image: { mediaType: type as ShotImageType, base64 } }
        : { document: { mediaType: "application/pdf" as const, base64, fileName: upload.file.filename || "records.pdf" } }),
      today: ctx.today,
      timezone: ctx.timezone,
      categories: ctx.categories,
    });
    await auditAiRead(orgId, "ai.finance_import_read", {
      connection: creds.id,
      model,
      mode: isImage ? "image" : "pdf",
      bytes: upload.file.bytes.length,
      records: result.rows.length + result.budget.length,
    });
    return json(200, { ...result, readBy: label });
  } catch (error) {
    if (error instanceof AiImportError) return json(error.status, { error: error.message });
    throw error;
  }
}
