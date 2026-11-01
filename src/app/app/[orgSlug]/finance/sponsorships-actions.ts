"use server";

import { z } from "zod";

import {
  SponsorshipStatus,
  SponsorshipType,
  TransactionDirection,
  TransactionKind,
} from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { withOrgAction, type OrgContext } from "@/server/db/context";

/** Every action here belongs to sponsorships (withOrgAction's space check). */
const sponsorshipsAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "sponsorships" });

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

export const createSponsor = sponsorshipsAction(
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
  /** An existing sponsor, or `sponsorName` to add one on the spot. */
  sponsorId: z.string().optional(),
  sponsorName: z.string().trim().max(200).optional(),
  /** Where it starts (Prospect unless said); Received books the money at once. */
  status: z.enum(SPONSORSHIP_STATUS_VALUES).optional(),
  budgetPeriodId: z.string(),
  type: z.enum([SponsorshipType.CASH, SponsorshipType.CREDITS]).default(SponsorshipType.CASH),
  amountCents: z.number().int().positive("Amount must be greater than zero."),
  tier: z.string().max(100).nullable().optional(),
  deliverables: z.string().max(2000).nullable().optional(),
  expectedOn: z.string().nullable().optional(),
  /** Left out: the person adding it. */
  ownerId: z.string().optional(),
});

export const createSponsorship = sponsorshipsAction(
  async (ctx, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const parsed = sponsorshipInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    // Sequential: one transaction, one connection.
    let sponsor: { id: string } | null = null;
    if (data.sponsorId) {
      sponsor = await ctx.db.sponsor.findFirst({
        where: { id: data.sponsorId, organizationId },
        select: { id: true },
      });
    } else if (data.sponsorName) {
      // Typed a name: the sponsor it already is, or a new one.
      sponsor =
        (await ctx.db.sponsor.findFirst({
          where: { organizationId, name: { equals: data.sponsorName, mode: "insensitive" } },
          select: { id: true },
        })) ??
        (await ctx.db.sponsor.create({
          data: { organizationId, name: data.sponsorName },
          select: { id: true },
        }));
    }
    if (!sponsor) return { error: "Pick a sponsor or type a new one." };
    const ownerId = data.ownerId || ctx.userId;
    const period = await ctx.db.budgetPeriod.findFirst({
      where: { id: data.budgetPeriodId, organizationId },
      select: { id: true },
    });
    if (!period) return { error: "Budget period not found." };
    const owner = await ctx.db.membership.findUnique({
      where: { userId_organizationId: { userId: ownerId, organizationId } },
      select: { userId: true },
    });
    if (!owner) return { error: "Owner must be a member of this organization." };

    const created = await ctx.db.sponsorship.create({
      data: {
        organizationId,
        sponsorId: sponsor.id,
        budgetPeriodId: data.budgetPeriodId,
        type: data.type,
        amountCents: data.amountCents,
        tier: data.tier || null,
        deliverables: data.deliverables || null,
        expectedOn: data.expectedOn ? new Date(data.expectedOn) : null,
        ownerId,
      },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId,
      sponsorshipId: created.id,
      action: "SPONSORSHIP_CREATE",
      after: created,
    });
    if (data.status && data.status !== SponsorshipStatus.PROSPECT) {
      const moved = await setSponsorshipStatus(ctx, created.id, data.status);
      if (moved.error) return moved;
    }

    return { sponsorshipId: created.id, sponsorId: sponsor.id };
  },
);

/**
 * Reaching RECEIVED generates the corresponding IN transaction; nothing
 * before that touches the ledger. Moving back out of RECEIVED voids that
 * transaction rather than deleting it (spec 5.6) — pledged money never
 * silently disappears from the audit trail. Credits never touch the ledger:
 * no money changes hands, so their status is all that changes.
 */
export const updateSponsorshipStatus = sponsorshipsAction(
  async (ctx, sponsorshipId: string, status: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    return setSponsorshipStatus(ctx, sponsorshipId, status);
  },
);

async function setSponsorshipStatus(
  ctx: OrgContext,
  sponsorshipId: string,
  status: string,
): Promise<ActionResult> {
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

  return { sponsorshipId };
}

const sponsorshipEditSchema = z.object({
  amountCents: z.number().int().positive("Amount must be greater than zero.").optional(),
  tier: z.string().max(100).nullable().optional(),
  ownerId: z.string().optional(),
  expectedOn: z.string().nullable().optional(),
});

/**
 * Edits a sponsorship in place (it used to be delete and start over). A
 * received cash sponsorship's money moves with it, unless that transaction
 * is already reconciled against a statement.
 */
export const updateSponsorship = sponsorshipsAction(
  async (ctx, sponsorshipId: string, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;
    const parsed = sponsorshipEditSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;
    const existing = await ctx.db.sponsorship.findFirst({
      where: { id: sponsorshipId, organizationId },
    });
    if (!existing) return { error: "Sponsorship not found." };
    if (data.ownerId) {
      const owner = await ctx.db.membership.findUnique({
        where: { userId_organizationId: { userId: data.ownerId, organizationId } },
        select: { userId: true },
      });
      if (!owner) return { error: "Owner must be a member of this organization." };
    }
    if (
      data.amountCents !== undefined &&
      data.amountCents !== existing.amountCents &&
      existing.transactionId
    ) {
      const money = await ctx.db.transaction.findFirst({
        where: { id: existing.transactionId, organizationId },
        select: { reconciledAt: true, voidedAt: true },
      });
      if (money && !money.voidedAt) {
        if (money.reconciledAt) {
          return {
            error: "The money it booked is reconciled. Unlock it under Transactions first.",
          };
        }
        await ctx.db.transaction.update({
          where: { id: existing.transactionId },
          data: { amountCents: data.amountCents },
        });
      }
    }
    const updated = await ctx.db.sponsorship.update({
      where: { id: sponsorshipId },
      data: {
        amountCents: data.amountCents,
        tier: data.tier === undefined ? undefined : data.tier || null,
        ownerId: data.ownerId,
        expectedOn:
          data.expectedOn === undefined
            ? undefined
            : data.expectedOn
              ? new Date(data.expectedOn)
              : null,
      },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId,
      sponsorshipId,
      action: "SPONSORSHIP_UPDATE",
      before: existing,
      after: updated,
    });
    return { sponsorshipId };
  },
);

/**
 * Deletes a sponsorship (a wrong entry, a deal that never happened). Money
 * already received is its own transaction and stays in the books; delete
 * that under Transactions if it was a mistake too. The audit log keeps the
 * deleted row.
 */
export const deleteSponsorship = sponsorshipsAction(
  async (ctx, sponsorshipId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;
    const sponsorship = await ctx.db.sponsorship.findFirst({
      where: { id: sponsorshipId, organizationId },
      include: { sponsor: { select: { name: true } } },
    });
    if (!sponsorship) return { error: "Sponsorship not found." };
    await ctx.db.sponsorship.delete({ where: { id: sponsorship.id } });
    await writeFinanceAuditLog(ctx.db, {
      organizationId,
      transactionId: sponsorship.transactionId ?? undefined,
      action: "SPONSORSHIP_DELETE",
      before: sponsorship,
    });
    return {};
  },
);

/** Deletes a sponsor with no sponsorships left (delete those first). */
export const deleteSponsor = sponsorshipsAction(
  async (ctx, sponsorId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;
    const sponsor = await ctx.db.sponsor.findFirst({
      where: { id: sponsorId, organizationId },
      include: { _count: { select: { sponsorships: true } } },
    });
    if (!sponsor) return { error: "Sponsor not found." };
    if (sponsor._count.sponsorships > 0) {
      const n = sponsor._count.sponsorships;
      return {
        error: `${sponsor.name} still has ${n} sponsorship${n === 1 ? "" : "s"}. Delete ${n === 1 ? "it" : "them"} first.`,
      };
    }
    await ctx.db.sponsor.delete({ where: { id: sponsor.id } });
    await writeFinanceAuditLog(ctx.db, {
      organizationId,
      action: "SPONSOR_DELETE",
      before: { id: sponsor.id, name: sponsor.name },
    });
    return {};
  },
);
