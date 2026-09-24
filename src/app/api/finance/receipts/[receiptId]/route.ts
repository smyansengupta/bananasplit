import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { readReceiptBlob } from "@/lib/finance/receipt-storage";
import { verifyReceiptToken } from "@/lib/finance/receipt-signed-url";
import { contentDisposition } from "@/lib/http/content-disposition";
import { withOrgTx } from "@/server/db/context";

/**
 * GET /api/finance/receipts/{receiptId}?org={orgId}&token=... — streams a
 * receipt back, only to someone who may see it right now (spec 5.5).
 *
 * The signed token (receipt, org, expiry; minted by getSignedReceiptUrl
 * after its own permission check) only proves the link is recent. The row
 * is read in a withOrgTx transaction as the caller, so membership and the
 * Receipt policy (the transaction's submitter, or OWNER/TREASURER) are
 * checked again by the database; the file is read after that transaction,
 * outside it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const { receiptId } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const organizationId = url.searchParams.get("org");

  if (!token || !organizationId || !verifyReceiptToken(receiptId, organizationId, token)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const session = await getSession();
  if (!session) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let receipt;
  try {
    receipt = await withOrgTx(organizationId, ({ db }) =>
      db.receipt.findFirst({
        where: { id: receiptId, organizationId },
        select: { blobKey: true, filename: true, mimeType: true },
      }),
    );
  } catch (error) {
    // No longer a member of the org.
    if (error instanceof NotFoundError) return new NextResponse("Forbidden", { status: 403 });
    throw error;
  }
  // Missing, or not visible to the caller (RLS hides both the same way).
  if (!receipt) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await readReceiptBlob(receipt.blobKey);
  if (!bytes) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": receipt.mimeType,
      // The stored name is whatever the uploader's device called the file:
      // escaped per RFC 5987, never interpolated raw (0A Fix 12).
      "Content-Disposition": contentDisposition("inline", receipt.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
