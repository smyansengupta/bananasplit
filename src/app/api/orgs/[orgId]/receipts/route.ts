import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_RECEIPT_BYTES,
  RECEIPT_EXTENSIONS,
  sniffMimeType,
} from "@/lib/finance/file-sniff";
import { deleteReceiptBlobs } from "@/lib/finance/receipt-storage";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { withOrgAction, withOrgTx } from "@/server/db/context";
import { putBlob } from "@/server/storage";
import { readUpload, UploadError } from "@/server/storage/upload";

/**
 * POST /api/orgs/{orgId}/receipts (0A Fix 15): multipart form with `file`
 * and `transactionId`. A route handler rather than a Server Action, because
 * Server Actions accept 1 MB bodies and receipts are phone photos. The cap is
 * 4 MB, under Vercel's ~4.5 MB request body limit; the client downscales
 * larger images first.
 *
 * Order of work (0C: no network I/O inside a transaction):
 *   1. a membership check (withOrgTx; a non-member gets 404, before the body
 *      is read), then the capped body read (readUpload);
 *   2. a read transaction: the transaction row, and whether the caller may
 *      attach to it (its submitter, or OWNER/TREASURER);
 *   3. the Blob put (putBlob, kind `receipts`), outside any transaction;
 *   4. a write transaction for the Receipt row (RLS repeats the attach rule);
 *      if it fails, the blob is deleted again.
 * The storage key is receipts/{orgId}/{transactionId}/{random}.{ext}: the
 * client file name is stored only in Receipt.filename, never in the key.
 */
export const maxDuration = 60;

const UPLOAD_RATE_LIMIT = 20;
const UPLOAD_RATE_WINDOW_SEC = 60 * 60;

const TOO_LARGE = "Receipts are capped at 4 MB. Try a smaller photo or a compressed PDF.";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Route handlers get no built-in CSRF check (Server Actions do): refuse a
 * browser request whose Origin is another site.
 */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function uploadError(error: unknown): Response {
  if (!(error instanceof UploadError)) throw error;
  if (error.status === 413) return json(413, { error: TOO_LARGE });
  if (error.status === 415) return json(400, { error: "Expected a multipart form with a file." });
  return json(error.status, { error: error.message });
}

interface ReceiptRow {
  transactionId: string;
  blobKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Step 4: the row, as app_user (the Receipt INSERT policy re-checks the attach rule). */
const createReceiptRow = withOrgAction(async (ctx, row: ReceiptRow) => {
  const receipt = await ctx.db.receipt.create({
    data: { organizationId: ctx.organizationId, uploadedById: ctx.userId, ...row },
    select: { id: true },
  });
  return receipt.id;
});

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;

  if (isCrossSite(request)) {
    return json(403, { error: "Forbidden." });
  }

  const session = await getSession();
  if (!session) {
    return json(401, { error: "Sign in to upload receipts." });
  }

  try {
    await withOrgTx(orgId, async () => undefined);
  } catch (error) {
    // Not "forbidden": a non-member cannot learn whether the org exists.
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }

  const upload = await readUpload(request, { maxBytes: MAX_RECEIPT_BYTES }).catch(uploadError);
  if (upload instanceof Response) return upload;
  const { file, fields } = upload;
  const transactionId = fields.transactionId;
  if (!transactionId) {
    return json(400, { error: "No file provided." });
  }

  const target = await withOrgTx(orgId, async (ctx) => {
    const transaction = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: orgId },
      select: { id: true, submittedById: true },
    });
    if (!transaction) return null;
    return {
      id: transaction.id,
      canAttach: transaction.submittedById === ctx.userId || can(ctx, "finance.manage"),
    };
  });
  if (!target) {
    return json(404, { error: "Transaction not found." });
  }
  if (!target.canAttach) {
    return json(403, {
      error: "You don't have permission to attach receipts to this transaction.",
    });
  }

  const rateLimit = await checkRateLimit(
    rateLimitKey("receipt-upload", session.user.id),
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW_SEC,
  );
  if (!rateLimit.allowed) {
    return json(429, { error: "Too many receipt uploads recently. Try again in a few minutes." });
  }

  const bytes = file.bytes;
  const mimeType = sniffMimeType(bytes);
  if (!mimeType || !ALLOWED_RECEIPT_MIME_TYPES.has(mimeType)) {
    return json(415, { error: "Only image and PDF receipts are supported." });
  }

  const stored = await putBlob(
    "receipts",
    orgId,
    [target.id, `${randomUUID()}.${RECEIPT_EXTENSIONS[mimeType]}`],
    bytes,
    { contentType: mimeType },
  );

  try {
    const receiptId = await createReceiptRow(orgId, {
      transactionId: target.id,
      blobKey: stored.key,
      filename: file.filename || "receipt",
      mimeType,
      sizeBytes: bytes.length,
    });
    return json(201, { receiptId });
  } catch (error) {
    await deleteReceiptBlobs([stored.key]);
    throw error;
  }
}
