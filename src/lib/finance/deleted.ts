/**
 * Deleting a transaction voids it with this reason (money rows are never
 * erased; the finance audit log keeps every change), so lists can tell a
 * deleted transaction from one a treasurer voided with an explanation.
 */
export const DELETED_TRANSACTION_REASON = "Deleted";

export function isDeletedTransaction(t: { voidedAt: Date | string | null; voidReason?: string | null }): boolean {
  return t.voidedAt !== null && t.voidReason === DELETED_TRANSACTION_REASON;
}
