import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { normalizeOrgChart, type NormalizedChart } from "@/lib/org-chart/normalize";
import type { ParseReport } from "@/lib/org-chart/types";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { withOrgAction, withOrgTx } from "@/server/db/context";
import { extractSource, preflightSource, sniffSource, SourceRejectedError } from "@/server/org-chart/extract";
import { BUILTIN_CONFIDENCE_THRESHOLD, parseOrgChartText } from "@/server/org-chart/parse";
import {
  assertUploadAllowed,
  createUploadVersion,
  hasClaudeKey,
  newVersionId,
  OrgChartError,
} from "@/server/org-chart/service";
import { deleteBlobs, MAX_UPLOAD_BYTES, putBlob, randomKeyId } from "@/server/storage";
import { readUpload, UploadError } from "@/server/storage/upload";
import { isCrossSite } from "@/lib/http/cross-site";

/**
 * POST /api/orgs/{orgId}/org-chart/imports (ADMIN+): multipart form with
 * `file`. Uploads go through a route handler because Server Actions take
 * 1 MB bodies; the cap is 4 MB, checked from Content-Length before the body
 * is read and again while it streams (readUpload).
 *
 * Order of work:
 *   1. same-site check, session, membership and orgchart.write, rate limit;
 *   2. read the body; sniff the type from the bytes (PDF, DOCX, MD, TXT;
 *      .docm, ODT and RTF refused) and run the cheap preflight (DOCX
 *      zip-bomb guards, PDF page cap, text length);
 *   3. extract the text and run the BUILT-IN parser here, in the request:
 *      it is pure computation, needs no API key and costs nothing, so a
 *      document it understands is ready to review the moment the upload
 *      finishes. A PDF has no text to read locally, so it has no built-in
 *      reading;
 *   4. a read transaction checks the quota (only when Claude will be asked)
 *      so a refused upload stores nothing;
 *   5. the original goes to the PRIVATE store at
 *      org-chart/{orgId}/{versionId}/{random}.{ext}, outside any transaction;
 *   6. a short transaction creates the version under the org lock: READY
 *      with the built-in positions, or PENDING plus a claude-parse job when
 *      the reading was not good enough and the org has a key. If it fails
 *      the blob is deleted again.
 * After commit, enqueueJob's after() only kicks /api/cron/jobs for the heavy
 * kind; Claude is never called inside this request.
 */
export const maxDuration = 60;

const UPLOAD_RATE_LIMIT = 30;
const UPLOAD_RATE_WINDOW_SEC = 60 * 60;
const MULTIPART_OVERHEAD = 64 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const createVersion = withOrgAction(createUploadVersion);

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });

  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
    return json(413, { error: "Files are limited to 4 MB." });
  }

  const session = await getSession();
  if (!session) return json(401, { error: "Sign in to import an org chart." });

  let access: { allowed: boolean };
  try {
    access = await withOrgTx(orgId, async (ctx) => ({ allowed: can(ctx, "orgchart.write") }));
  } catch (error) {
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }
  if (!access.allowed) return json(403, { error: "Only owners and admins can import an org chart." });

  const limited = await checkRateLimit(
    rateLimitKey("orgchart-upload", session.user.id),
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW_SEC,
  );
  if (!limited.allowed) {
    return json(429, { error: `Too many uploads. Try again ${retryAfterText(limited)}.` });
  }

  let upload;
  try {
    upload = await readUpload(request);
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { error: error.message });
    throw error;
  }
  const { bytes, filename, size } = upload.file;

  let sniffed;
  try {
    sniffed = sniffSource(bytes, filename);
    preflightSource(bytes, sniffed);
  } catch (error) {
    if (error instanceof SourceRejectedError) return json(error.status, { error: error.message });
    throw error;
  }

  // The built-in parser, here in the request: no key, no network, no cost.
  let builtin: { chart: NormalizedChart; report: ParseReport } | null = null;
  try {
    const source = await extractSource(bytes, sniffed);
    if (source.type === "text") {
      const result = parseOrgChartText(source.text);
      builtin = { chart: normalizeOrgChart(result.parse), report: result.report };
    }
  } catch (error) {
    if (error instanceof SourceRejectedError) return json(error.status, { error: error.message });
    throw error;
  }
  const accepted = (builtin?.report.confidence ?? 0) >= BUILTIN_CONFIDENCE_THRESHOLD;

  // Claude is only asked about a document the parser could not read well.
  // Its quota is checked before anything is stored, so a refusal is clean.
  let claudeAvailable = false;
  try {
    claudeAvailable = await withOrgTx(orgId, async (ctx) => {
      const hasKey = await hasClaudeKey(ctx.db, orgId);
      if (!accepted && hasKey) await assertUploadAllowed(ctx.db, orgId);
      return hasKey;
    });
  } catch (error) {
    if (error instanceof OrgChartError) return json(error.status, { error: error.message });
    throw error;
  }

  const versionId = newVersionId();
  const stored = await putBlob("org-chart", orgId, [versionId, `${randomKeyId()}.${sniffed.extension}`], bytes, {
    contentType: sniffed.mimeType,
  });

  try {
    const created = await createVersion(orgId, {
      versionId,
      filename,
      mimeType: sniffed.mimeType,
      sizeBytes: size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      blobKey: stored.key,
      builtin,
      accepted,
      claudeAvailable,
    });
    return json(201, {
      versionId: created.versionId,
      number: created.number,
      ready: created.ready,
      reader: created.method.toLowerCase(),
    });
  } catch (error) {
    await deleteBlobs([stored.key]).catch(() => undefined);
    if (error instanceof OrgChartError) return json(error.status, { error: error.message });
    if (error instanceof ForbiddenError) return json(403, { error: error.message });
    throw error;
  }
}
