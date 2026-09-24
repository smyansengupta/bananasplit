"use server";

import { can } from "@/lib/auth/permissions";
import { deleteReceiptBlobs } from "@/lib/finance/receipt-storage";
import { receiptDownloadUrl } from "@/lib/finance/receipt-signed-url";
import { withOrgAction, type OrgContext } from "@/server/db/context";

// Uploads go through POST /api/orgs/{orgId}/receipts (0A Fix 15): a route
// handler, because Server Actions accept 1 MB bodies and receipts are
// phone photos.

interface ActionResult {
  error?: string;
  receiptId?: string;
}

/** The transaction's submitter, or OWNER/TREASURER (the Receipt policy repeats this). */
function canAccessTransaction(ctx: OrgContext, transaction: { submittedById: string }) {
  return transaction.submittedById === ctx.userId || can(ctx, "finance.manage");
}

/**
 * Deletes the row in the action's transaction and the file after it commits
 * (row first, blob second: a failed blob delete leaves an orphan file, never
 * a row pointing at nothing). Error semantics: { error } before the write
 * (case a); the Blob delete is network I/O and runs after commit (case d).
 */
export const deleteReceiptAction = withOrgAction(
  async (ctx, receiptId: string): Promise<ActionResult> => {
    const receipt = await ctx.db.receipt.findFirst({
      where: { id: receiptId, organizationId: ctx.organizationId },
      include: { transaction: { select: { submittedById: true } } },
    });
    if (!receipt) return { error: "Receipt not found." };
    if (!canAccessTransaction(ctx, receipt.transaction)) {
      return { error: "You don't have permission to remove this receipt." };
    }

    await ctx.db.receipt.deleteMany({
      where: { id: receiptId, organizationId: ctx.organizationId },
    });
    const blobKey = receipt.blobKey;
    ctx.afterCommit(() => deleteReceiptBlobs([blobKey]));
    return {};
  },
);

/**
 * Returns a short-lived signed download URL, only after re-running the same
 * permission check as the parent transaction (spec 5.5) — never the raw
 * blob key/URL.
 */
export const getSignedReceiptUrl = withOrgAction(
  async (ctx, receiptId: string): Promise<{ url?: string; error?: string }> => {
    const receipt = await ctx.db.receipt.findFirst({
      where: { id: receiptId, organizationId: ctx.organizationId },
      include: { transaction: { select: { submittedById: true } } },
    });
    if (!receipt) return { error: "Receipt not found." };
    if (!canAccessTransaction(ctx, receipt.transaction)) {
      return { error: "You don't have permission to view this receipt." };
    }

    return { url: receiptDownloadUrl(receiptId, ctx.organizationId) };
  },
);
