"use server";

import { z } from "zod";

import {
  SponsorshipStatus,
  TransactionDirection,
  TransactionKind,
} from "@/generated/prisma/client";
import { requireFinanceAccess } from "@/lib/auth/guards";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { prisma } from "@/lib/prisma";

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

export async function createSponsor(organizationId: string, input: unknown): Promise<ActionResult> {
  await requireFinanceAccess(organizationId);

  const parsed = sponsorInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const sponsor = await prisma.sponsor.create({
    data: {
      organizationId,
      name: data.name,
      contactName: data.contactName || null,
      contactEmail: data.contactEmail || null,
      notes: data.notes || null,
    },
  });
  return { sponsorId: sponsor.id };
}

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

export async function createSponsorship(
  organizationId: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireFinanceAccess(organizationId);

  const parsed = sponsorshipInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const [sponsor, period, owner] = await Promise.all([
    prisma.sponsor.findFirst({ where: { id: data.sponsorId, organizationId } }),
    prisma.budgetPeriod.findFirst({ where: { id: data.budgetPeriodId, organizationId } }),
    prisma.membership.findUnique({
      where: { userId_organizationId: { userId: data.ownerId, organizationId } },
    }),
  ]);
  if (!sponsor) return { error: "Sponsor not found." };
  if (!period) return { error: "Budget period not found." };
  if (!owner) return { error: "Owner must be a member of this organization." };

  const sponsorship = await prisma.$transaction(async (tx) => {
    const created = await tx.sponsorship.create({
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
    await writeFinanceAuditLog(tx, {
      organizationId,
      actorId: ctx.user.id,
      sponsorshipId: created.id,
      action: "SPONSORSHIP_CREATE",
      after: created,
    });
    return created;
  });

  return { sponsorshipId: sponsorship.id };
}

/**
 * Reaching RECEIVED generates the corresponding IN transaction; nothing
 * before that touches the ledger. Moving back out of RECEIVED voids that
 * transaction rather than deleting it (spec 5.6) — pledged money never
 * silently disappears from the audit trail.
 */
export async function updateSponsorshipStatus(
  organizationId: string,
  sponsorshipId: string,
  status: string,
): Promise<ActionResult> {
  const ctx = await requireFinanceAccess(organizationId);

  const parsedStatus = z.enum(SPONSORSHIP_STATUS_VALUES).safeParse(status);
  if (!parsedStatus.success) return { error: "Invalid status." };

  const sponsorship = await prisma.sponsorship.findFirst({
    where: { id: sponsorshipId, organizationId },
  });
  if (!sponsorship) return { error: "Sponsorship not found." };

  const nextStatus = parsedStatus.data;
  if (nextStatus === sponsorship.status) return { sponsorshipId };

  await prisma.$transaction(async (tx) => {
    let transactionId = sponsorship.transactionId;

    if (nextStatus === SponsorshipStatus.RECEIVED) {
      const existing = transactionId
        ? await tx.transaction.findUnique({ where: { id: transactionId } })
        : null;

      if (existing) {
        // Re-entering RECEIVED after a prior void (e.g. RECEIVED -> COMMITTED
        // -> RECEIVED): un-void the same transaction instead of creating a
        // second one for the same pledge.
        await tx.transaction.update({
          where: { id: existing.id },
          data: { voidedAt: null, voidReason: null },
        });
        await writeFinanceAuditLog(tx, {
          organizationId,
          actorId: ctx.user.id,
          transactionId: existing.id,
          sponsorshipId,
          action: "SPONSORSHIP_TRANSACTION_UNVOID",
          before: { voidedAt: existing.voidedAt },
          after: { voidedAt: null },
        });
      } else {
        const transaction = await tx.transaction.create({
          data: {
            organizationId,
            budgetPeriodId: sponsorship.budgetPeriodId,
            direction: TransactionDirection.IN,
            kind: TransactionKind.SPONSORSHIP,
            amountCents: sponsorship.amountCents,
            description: `Sponsorship received`,
            occurredAt: new Date(),
            submittedById: ctx.user.id,
            status: "NOT_APPLICABLE",
          },
        });
        transactionId = transaction.id;
        await writeFinanceAuditLog(tx, {
          organizationId,
          actorId: ctx.user.id,
          transactionId,
          sponsorshipId,
          action: "SPONSORSHIP_TRANSACTION_CREATE",
          after: transaction,
        });
      }
    } else if (sponsorship.status === SponsorshipStatus.RECEIVED && transactionId) {
      const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (existing && !existing.voidedAt) {
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            voidedAt: new Date(),
            voidReason: `Sponsorship moved from RECEIVED to ${nextStatus}`,
          },
        });
        await writeFinanceAuditLog(tx, {
          organizationId,
          actorId: ctx.user.id,
          transactionId,
          sponsorshipId,
          action: "SPONSORSHIP_TRANSACTION_VOID",
          before: { voidedAt: null },
          after: { voidedAt: new Date() },
        });
      }
    }

    const updated = await tx.sponsorship.update({
      where: { id: sponsorshipId },
      data: { status: nextStatus, transactionId },
    });
    await writeFinanceAuditLog(tx, {
      organizationId,
      actorId: ctx.user.id,
      sponsorshipId,
      action: "SPONSORSHIP_STATUS_CHANGE",
      before: { status: sponsorship.status },
      after: { status: updated.status },
    });
  });

  return { sponsorshipId };
}
