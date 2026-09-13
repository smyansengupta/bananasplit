import { NextResponse } from "next/server";

import { Role } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth/session";
import { getReceiptBytes } from "@/lib/finance/receipt-storage";
import { verifyReceiptToken } from "@/lib/finance/receipt-signed-url";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const { receiptId } = await params;
  const token = new URL(request.url).searchParams.get("token");

  // The signed token proves the link hasn't expired; it is never a
  // substitute for re-checking who is asking right now.
  if (!token || !verifyReceiptToken(receiptId, token)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const session = await getSession();
  if (!session) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { transaction: true },
  });
  if (!receipt) {
    return new NextResponse("Not found", { status: 404 });
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: session.user.id,
        organizationId: receipt.transaction.organizationId,
      },
    },
  });
  const isPermitted =
    membership &&
    (receipt.transaction.submittedById === session.user.id ||
      membership.role === Role.OWNER ||
      membership.role === Role.TREASURER);
  if (!isPermitted) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bytes = await getReceiptBytes(receipt.blobKey);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": receipt.mimeType,
      "Content-Disposition": `inline; filename="${receipt.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
