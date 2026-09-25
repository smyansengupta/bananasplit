import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { withOrgAction, withOrgTx } from "@/server/db/context";
import { preflightSource, sniffSource, SourceRejectedError } from "@/server/org-chart/extract";
import {
  assertUploadAllowed,
  createUploadVersion,
  hasClaudeKey,
  newVersionId,
  OrgChartError,
} from "@/server/org-chart/service";
import { deleteBlobs, MAX_UPLOAD_BYTES, putBlob, randomKeyId } from "@/server/storage";
import { readUpload, UploadError } from "@/server/storage/upload";

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
 *   3. a read transaction checks the Claude key and the quota, so a refused
 *      upload stores nothing;
 *   4. the original goes to the PRIVATE store at
 *      org-chart/{orgId}/{versionId}/{random}.{ext}, outside any transaction;
 *   5. a short transaction creates the DRAFT version (parseStatus PENDING),
 *      re-checks the quota under the org lock and enqueues claude-parse; if
 *      it fails the blob is deleted again.
 * After commit, enqueueJob's after() only kicks /api/cron/jobs for the heavy
 * kind; the parse never runs inside this request.
 */
export const maxDuration = 60;

const UPLOAD_RATE_LIMIT = 30;
const UPLOAD_RATE_WINDOW_SEC = 60 * 60;
const MULTIPART_OVERHEAD = 64 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Route handlers get no built-in CSRF check: refuse another site's browser request. */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
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
  if (!access.allowed)
    return json(403, { error: "Only owners and admins can import an org chart." });

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

  // Refuse before storing anything when there is no key or no quota left.
  try {
    await withOrgTx(orgId, async (ctx) => {
      if (!(await hasClaudeKey(ctx.db, orgId))) {
        throw new OrgChartError(
          "Add a Claude API key in Settings > Integrations before importing a document.",
          409,
        );
      }
      await assertUploadAllowed(ctx.db, orgId);
    });
  } catch (error) {
    if (error instanceof OrgChartError) return json(error.status, { error: error.message });
    throw error;
  }

  const versionId = newVersionId();
  const stored = await putBlob(
    "org-chart",
    orgId,
    [versionId, `${randomKeyId()}.${sniffed.extension}`],
    bytes,
    {
      contentType: sniffed.mimeType,
    },
  );

  try {
    const created = await createVersion(orgId, {
      versionId,
      filename,
      mimeType: sniffed.mimeType,
      sizeBytes: size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      blobKey: stored.key,
    });
    return json(201, { versionId: created.versionId, number: created.number });
  } catch (error) {
    await deleteBlobs([stored.key]).catch(() => undefined);
    if (error instanceof OrgChartError) return json(error.status, { error: error.message });
    if (error instanceof ForbiddenError) return json(403, { error: error.message });
    throw error;
  }
}
