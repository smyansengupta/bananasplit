"use server";

import { Role } from "@/generated/prisma/client";
import { withOrgContext } from "@/lib/auth/with-org-context";
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_RECEIPT_BYTES,
  sniffMimeType,
} from "@/lib/finance/file-sniff";
import { deleteReceipt, putReceipt } from "@/lib/finance/receipt-storage";
import { signReceiptToken } from "@/lib/finance/receipt-signed-url";
import { prisma } from "@/lib/prisma";

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

export const uploadReceipt = withOrgContext(
  async (ctx, transactionId: string, formData: FormData): Promise<ActionResult> => {
    const transaction = await prisma.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!transaction) return { error: "Transaction not found." };
    if (!canAccessTransaction(ctx, transaction)) {
      return { error: "You don't have permission to attach receipts to this transaction." };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "No file provided." };
    if (file.size > MAX_RECEIPT_BYTES) return { error: "Receipts are capped at 10 MB." };

    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMimeType(bytes);
    if (!sniffed || !ALLOWED_RECEIPT_MIME_TYPES.has(sniffed)) {
      return { error: "Only image and PDF receipts are supported." };
    }

    const { blobKey } = await putReceipt(
      `receipts/${ctx.organizationId}/${transactionId}/${Date.now()}-${file.name}`,
      bytes,
      sniffed,
    );

    const receipt = await prisma.receipt.create({
      data: {
        transactionId,
        blobKey,
        filename: file.name || "receipt",
        mimeType: sniffed,
        sizeBytes: bytes.length,
        uploadedById: ctx.user.id,
      },
    });

    return { receiptId: receipt.id };
  },
);

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
