"use server";

import { Role } from "@/generated/prisma/client";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { deleteReceipt } from "@/lib/finance/receipt-storage";
import { signReceiptToken } from "@/lib/finance/receipt-signed-url";
import { prisma } from "@/lib/prisma";

// Uploads go through POST /api/orgs/{orgId}/receipts (0A Fix 15): a route
// handler, because Server Actions accept 1 MB bodies and receipts are
// phone photos.

interface ActionResult {
  error?: string;
  receiptId?: string;
}

function canAccessTransaction(
  ctx: { role: Role; user: { id: string } },
  transaction: { submittedById: string },
) {
  return (
    transaction.submittedById === ctx.user.id ||
    ctx.role === Role.OWNER ||
    ctx.role === Role.TREASURER
  );
}

export const deleteReceiptAction = withOrgContext(
  async (ctx, receiptId: string): Promise<ActionResult> => {
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, transaction: { organizationId: ctx.organizationId } },
      include: { transaction: true },
    });
    if (!receipt) return { error: "Receipt not found." };
    if (!canAccessTransaction(ctx, receipt.transaction)) {
      return { error: "You don't have permission to remove this receipt." };
    }

    // Row first, blob second: a failed blob delete leaves an orphan file,
    // never a row pointing at nothing.
    await prisma.receipt.delete({ where: { id: receiptId } });
    await deleteReceipt(receipt.blobKey);
    return {};
  },
);

/**
 * Returns a short-lived signed download URL, only after re-running the same
 * permission check as the parent transaction (spec 5.5) — never the raw
 * blob key/URL.
 */
export const getSignedReceiptUrl = withOrgContext(
  async (ctx, receiptId: string): Promise<{ url?: string; error?: string }> => {
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, transaction: { organizationId: ctx.organizationId } },
      include: { transaction: true },
    });
    if (!receipt) return { error: "Receipt not found." };
    if (!canAccessTransaction(ctx, receipt.transaction)) {
      return { error: "You don't have permission to view this receipt." };
    }

    const token = signReceiptToken(receiptId);
    return { url: `/api/finance/receipts/${receiptId}?token=${token}` };
  },
);
