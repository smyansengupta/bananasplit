import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/session";
import type { CrmObject } from "@/lib/crm/fields";
import { detectSource, parseVcards } from "@/lib/crm/mapping";
import { decodeText, readTableFile, SpreadsheetError } from "@/lib/finance/import/sheet";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { CrmError } from "@/server/crm/access";
import { createImportLog, importSample } from "@/server/crm/import";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { AppError } from "@/server/db/errors";
import { readUpload, UploadError } from "@/server/storage/upload";

/**
 * A file for the CRM's importer: POST multipart with `file` (CSV, TSV,
 * Excel, or a vCard .vcf) and `object` (person, company or deal). The file
 * is read here, its rows kept in the import's log for the mapping step, and
 * the answer is the columns, a preview and the suggested mapping. A route
 * handler, not a Server Action, because a Server Action's body is capped at
 * 1 MB. Rate-limited to 30 files an hour per person.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, ctx: { params: Promise<{ orgSlug: string }> }) {
  if (isCrossSite(request)) return json({ error: "Forbidden." }, 403);
  const { orgSlug } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return json({ error: "Sign in again." }, 401);
  }
  const resolved = await withUserTx(user.id, ({ db }) =>
    db.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`,
  );
  const orgId = resolved[0]?.organizationId;
  if (!orgId) return json({ error: "Not found." }, 404);
  const limit = await checkRateLimit(rateLimitKey("crm-import", user.id), 30, 3600);
  if (!limit.allowed) return json({ error: `Too many files. Try again ${retryAfterText(limit)}.` }, 429);

  let upload;
  try {
    upload = await readUpload(request, { maxBytes: MAX_BYTES });
  } catch (error) {
    if (error instanceof UploadError) {
      return json({ error: error.status === 413 ? "That file is over 4 MB. Split it first." : error.message }, error.status);
    }
    throw error;
  }
  const objectField = upload.fields.object;
  const object: CrmObject = objectField === "company" || objectField === "deal" ? objectField : "person";
  const fileName = upload.file.filename.slice(0, 200);
  let headers: string[];
  let rows: Record<string, string>[];
  try {
    if (/\.(vcf|vcard)$/i.test(fileName)) {
      const text = decodeText(upload.file.bytes);
      if (!text) return json({ error: "That file couldn't be read." }, 400);
      const parsed = parseVcards(text);
      headers = parsed.headers;
      rows = parsed.rows;
    } else {
      const sheets = readTableFile(fileName, upload.file.bytes);
      const sheet = sheets.find((s) => s.rows.length > 1) ?? sheets[0];
      if (!sheet || sheet.rows.length < 2) return json({ error: "That file has no rows under its headings." }, 400);
      const head = sheet.rows[0]!.map((h, i) => h.trim() || `Column ${i + 1}`);
      // Two columns with one name keep both: the second gets a number.
      const seen = new Map<string, number>();
      headers = head.map((h) => {
        const n = (seen.get(h) ?? 0) + 1;
        seen.set(h, n);
        return n === 1 ? h : `${h} ${n}`;
      });
      rows = sheet.rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
    }
  } catch (error) {
    if (error instanceof SpreadsheetError) return json({ error: error.message }, 400);
    throw error;
  }
  try {
    const result = await withOrgTx(orgId, async (octx) => {
      const log = await createImportLog(octx, {
        fileName,
        source: detectSource(headers, fileName),
        object,
        headers,
        rows,
      });
      return { log, sample: await importSample(octx.db, orgId, log.id) };
    });
    return json(result);
  } catch (error) {
    if (error instanceof CrmError) return json({ error: error.message }, 400);
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    console.error("[crm] import upload failed", error instanceof Error ? error.message : error);
    return json({ error: "That file couldn't be read. Nothing was saved." }, 500);
  }
}
