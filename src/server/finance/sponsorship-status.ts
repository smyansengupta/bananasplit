import { z } from "zod";

import {
  SponsorshipStatus,
  SponsorshipType,
  TransactionDirection,
  TransactionKind,
} from "@/generated/prisma/client";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { syncDealFromSponsorship } from "@/server/crm/sponsor-sync";
import type { TxClient } from "@/server/db/context";

/**
 * Moving a sponsorship between stages (Finance's one way to do it, shared
 * by Finance's own actions and the CRM's Sponsorships pipeline, so a move
 * to Received books the transaction exactly the same way from either).
 *
 * Reaching RECEIVED generates the corresponding IN transaction; nothing
 * before that touches the ledger. Moving back out of RECEIVED voids that
 * transaction rather than deleting it (spec 5.6) — pledged money never
 * silently disappears from the audit trail. Credits never touch the ledger:
 * no money changes hands, so their status is all that changes.
 *
 * The caller has checked finance.manage; RLS allows the writes only to the
 * organization's finance roles. After the move the CRM item made from this
 * sponsorship follows it (unless the move came from the CRM).
 */

export interface SponsorshipActor {
  db: TxClient;
  organizationId: string;
  userId: string;
}

const SPONSORSHIP_STATUS_VALUES = Object.values(SponsorshipStatus) as [
  SponsorshipStatus,
  ...SponsorshipStatus[],
];

export function isSponsorshipStatus(value: string): value is SponsorshipStatus {
  return (SPONSORSHIP_STATUS_VALUES as readonly string[]).includes(value);
}

export async function setSponsorshipStatus(
  ctx: SponsorshipActor,
  sponsorshipId: string,
  status: string,
  options: { fromCrm?: boolean } = {},
): Promise<{ error?: string; sponsorshipId?: string }> {
  const organizationId = ctx.organizationId;
  const db = ctx.db;

  const parsedStatus = z.enum(SPONSORSHIP_STATUS_VALUES).safeParse(status);
  if (!parsedStatus.success) return { error: "Invalid status." };

  const sponsorship = await db.sponsorship.findFirst({
    where: { id: sponsorshipId, organizationId },
    include: { sponsor: { select: { name: true } } },
  });
  if (!sponsorship) return { error: "Sponsorship not found." };

  const nextStatus = parsedStatus.data;
  if (nextStatus === sponsorship.status) return { sponsorshipId };

  let transactionId = sponsorship.transactionId;
  const isCash = sponsorship.type === SponsorshipType.CASH;

  if (isCash && nextStatus === SponsorshipStatus.RECEIVED) {
    const existing = transactionId
      ? await db.transaction.findFirst({ where: { id: transactionId, organizationId } })
      : null;

    if (existing) {
      // Re-entering RECEIVED after a prior void (e.g. RECEIVED -> COMMITTED
      // -> RECEIVED): un-void the same transaction instead of creating a
      // second one for the same pledge.
      await db.transaction.update({
        where: { id: existing.id },
        data: { voidedAt: null, voidReason: null },
      });
      await writeFinanceAuditLog(db, {
        organizationId,
        transactionId: existing.id,
        sponsorshipId,
        action: "SPONSORSHIP_TRANSACTION_UNVOID",
        before: { voidedAt: existing.voidedAt },
        after: { voidedAt: null },
      });
    } else {
      const transaction = await db.transaction.create({
        data: {
          organizationId,
          budgetPeriodId: sponsorship.budgetPeriodId,
          direction: TransactionDirection.IN,
          kind: TransactionKind.SPONSORSHIP,
          amountCents: sponsorship.amountCents,
          // Named for the sponsor, so the ledger tells them apart.
          description: `${sponsorship.sponsor.name} sponsorship`,
          occurredAt: new Date(),
          submittedById: ctx.userId,
          status: "NOT_APPLICABLE",
        },
      });
      transactionId = transaction.id;
      await writeFinanceAuditLog(db, {
        organizationId,
        transactionId,
        sponsorshipId,
        action: "SPONSORSHIP_TRANSACTION_CREATE",
        after: transaction,
      });
    }
  } else if (isCash && sponsorship.status === SponsorshipStatus.RECEIVED && transactionId) {
    const existing = await db.transaction.findFirst({
      where: { id: transactionId, organizationId },
    });
    if (existing && !existing.voidedAt) {
      await db.transaction.update({
        where: { id: transactionId },
        data: {
          voidedAt: new Date(),
          voidReason: `Sponsorship moved from RECEIVED to ${nextStatus}`,
        },
      });
      await writeFinanceAuditLog(db, {
        organizationId,
        transactionId,
        sponsorshipId,
        action: "SPONSORSHIP_TRANSACTION_VOID",
        before: { voidedAt: null },
        after: { voidedAt: new Date() },
      });
    }
  }

  const updated = await db.sponsorship.update({
    where: { id: sponsorshipId },
    data: { status: nextStatus, transactionId },
  });
  await writeFinanceAuditLog(db, {
    organizationId,
    sponsorshipId,
    action: "SPONSORSHIP_STATUS_CHANGE",
    before: { status: sponsorship.status },
    after: { status: updated.status },
  });
  if (!options.fromCrm) {
    await syncDealFromSponsorship(db, organizationId, ctx.userId, sponsorshipId);
  }

  return { sponsorshipId };
}
