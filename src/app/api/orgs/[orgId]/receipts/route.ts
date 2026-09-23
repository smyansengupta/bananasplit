import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { Role } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth/session";
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_RECEIPT_BYTES,
  RECEIPT_EXTENSIONS,
  sniffMimeType,
} from "@/lib/finance/file-sniff";
import { deleteReceipt, putReceipt } from "@/lib/finance/receipt-storage";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/orgs/{orgId}/receipts (0A Fix 15): multipart form with `file`
 * and `transactionId`. Replaces the uploadReceipt Server Action, which
 * inherited Next's 1 MB Server Action body limit, so every phone photo
 * failed. The cap is 4 MB, under Vercel's ~4.5 MB request body limit; the
 * client downscales larger images first.
 *
 * Order of work: the Blob put runs outside any transaction, then the
 * Receipt row is written; a failed row write deletes the blob again. The
 * storage key is receipts/{orgId}/{transactionId}/{random}.{ext}: the client
 * file name is stored only in Receipt.filename, never in the key.
 */
export const maxDuration = 60;

const UPLOAD_RATE_LIMIT = 20;
const UPLOAD_RATE_WINDOW_SEC = 60 * 60;
/** Room for the multipart boundaries and the other fields. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

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

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;

  if (isCrossSite(request)) {
    return json(403, { error: "Forbidden." });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RECEIPT_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return json(413, { error: TOO_LARGE });
  }

  const session = await getSession();
  if (!session) {
    return json(401, { error: "Sign in to upload receipts." });
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId: orgId } },
    select: { role: true },
  });
  if (!membership) {
    // Not "forbidden": a non-member cannot learn whether the org exists.
    return json(404, { error: "Not found." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Expected a multipart form with a file." });
  }
  const file = form.get("file");
  const transactionId = form.get("transactionId");
  if (!(file instanceof File) || typeof transactionId !== "string" || !transactionId) {
    return json(400, { error: "No file provided." });
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return json(413, { error: TOO_LARGE });
  }

  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, organizationId: orgId },
    select: { id: true, submittedById: true },
  });
  if (!transaction) {
    return json(404, { error: "Transaction not found." });
  }
  const canAttach =
    transaction.submittedById === session.user.id ||
    membership.role === Role.OWNER ||
    membership.role === Role.TREASURER;
  if (!canAttach) {
    return json(403, { error: "You don't have permission to attach receipts to this transaction." });
  }

  const rateLimit = await checkRateLimit(
    rateLimitKey("receipt-upload", session.user.id),
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW_SEC,
  );
  if (!rateLimit.allowed) {
    return json(429, { error: "Too many receipt uploads recently. Try again in a few minutes." });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_RECEIPT_BYTES) {
    return json(413, { error: TOO_LARGE });
  }
  const mimeType = sniffMimeType(bytes);
  if (!mimeType || !ALLOWED_RECEIPT_MIME_TYPES.has(mimeType)) {
    return json(415, { error: "Only image and PDF receipts are supported." });
  }

  const key = `receipts/${orgId}/${transaction.id}/${randomUUID()}.${RECEIPT_EXTENSIONS[mimeType]}`;
  const { blobKey } = await putReceipt(key, bytes, mimeType);

  try {
    const receipt = await prisma.receipt.create({
      data: {
        organizationId: orgId,
        transactionId: transaction.id,
        blobKey,
        filename: (file.name || "receipt").slice(0, 255),
        mimeType,
        sizeBytes: bytes.length,
        uploadedById: session.user.id,
      },
      select: { id: true },
    });
    return json(201, { receiptId: receipt.id });
  } catch (error) {
    await deleteReceipt(blobKey);
    throw error;
  }
}
