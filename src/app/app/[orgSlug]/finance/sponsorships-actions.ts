"use server";

import { z } from "zod";

import {
  SponsorshipStatus,
  TransactionDirection,
  TransactionKind,
} from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { withOrgAction } from "@/server/db/context";

/**
 * Sponsors and sponsorships (0C). These used to call requireFinanceAccess
 * directly; each now runs in one withOrgAction transaction as app_user,
 * checks finance.manage (OWNER or TREASURER), and RLS allows the writes only
 * to finance roles of the org (policy 6.9). Audit rows go through
 * app.write_finance_audit in the same transaction.
 *
 * Error semantics: every action returns its { error } before any write
 * (case a). The nested $transaction blocks are flattened into the wrapper's
 * transaction, so a failing audit write still rolls the change back.
 */

interface ActionResult {
  error?: string;
  sponsorId?: string;
  sponsorshipId?: string;
}

const sponsorInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal("")),
  notes: z.string().max(2000).nullable().optional(),
});

export const createSponsor = withOrgAction(
  async (ctx, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");

    const parsed = sponsorInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    const sponsor = await ctx.db.sponsor.create({
      data: {
        organizationId: ctx.organizationId,
        name: data.name,
        contactName: data.contactName || null,
        contactEmail: data.contactEmail || null,
        notes: data.notes || null,
      },
      select: { id: true },
    });
    return { sponsorId: sponsor.id };
  },
);

const SPONSORSHIP_STATUS_VALUES = Object.values(SponsorshipStatus) as [
  SponsorshipStatus,
  ...SponsorshipStatus[],
];

const sponsorshipInputSchema = z.object({
  sponsorId: z.string(),
  budgetPeriodId: z.string(),
  amountCents: z.number().int().positive("Amount must be greater than zero."),
  tier: z.string().max(100).nullable().optional(),
  deliverables: z.string().max(2000).nullable().optional(),
  expectedOn: z.string().nullable().optional(),
  ownerId: z.string(),
});

export const createSponsorship = withOrgAction(
  async (ctx, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const parsed = sponsorshipInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    // Sequential: one transaction, one connection.
    const sponsor = await ctx.db.sponsor.findFirst({
      where: { id: data.sponsorId, organizationId },
      select: { id: true },
    });
    if (!sponsor) return { error: "Sponsor not found." };
    const period = await ctx.db.budgetPeriod.findFirst({
      where: { id: data.budgetPeriodId, organizationId },
      select: { id: true },
    });
    if (!period) return { error: "Budget period not found." };
    const owner = await ctx.db.membership.findUnique({
      where: { userId_organizationId: { userId: data.ownerId, organizationId } },
      select: { userId: true },
    });
    if (!owner) return { error: "Owner must be a member of this organization." };

    const created = await ctx.db.sponsorship.create({
      data: {
        organizationId,
        sponsorId: data.sponsorId,
        budgetPeriodId: data.budgetPeriodId,
        amountCents: data.amountCents,
        tier: data.tier || null,
        deliverables: data.deliverables || null,
        expectedOn: data.expectedOn ? new Date(data.expectedOn) : null,
        ownerId: data.ownerId,
      },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId,
      sponsorshipId: created.id,
      action: "SPONSORSHIP_CREATE",
      after: created,
    });

    return { sponsorshipId: created.id };
  },
);

/**
 * Reaching RECEIVED generates the corresponding IN transaction; nothing
 * before that touches the ledger. Moving back out of RECEIVED voids that
 * transaction rather than deleting it (spec 5.6) — pledged money never
 * silently disappears from the audit trail.
 */
export const updateSponsorshipStatus = withOrgAction(
  async (ctx, sponsorshipId: string, status: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;
    const db = ctx.db;

    const parsedStatus = z.enum(SPONSORSHIP_STATUS_VALUES).safeParse(status);
    if (!parsedStatus.success) return { error: "Invalid status." };

    const sponsorship = await db.sponsorship.findFirst({
      where: { id: sponsorshipId, organizationId },
    });
    if (!sponsorship) return { error: "Sponsorship not found." };

    const nextStatus = parsedStatus.data;
    if (nextStatus === sponsorship.status) return { sponsorshipId };

    let transactionId = sponsorship.transactionId;

    if (nextStatus === SponsorshipStatus.RECEIVED) {
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
            description: `Sponsorship received`,
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
    } else if (sponsorship.status === SponsorshipStatus.RECEIVED && transactionId) {
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

    return { sponsorshipId };
  },
);
