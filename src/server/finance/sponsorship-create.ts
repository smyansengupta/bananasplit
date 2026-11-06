import { SponsorshipStatus, SponsorshipType } from "@/generated/prisma/client";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { syncDealFromSponsorship } from "@/server/crm/sponsor-sync";

import { setSponsorshipStatus, type SponsorshipActor } from "./sponsorship-status";

/**
 * Making a deal, a Sponsorship row (Finance's one way to do it, shared by
 * Finance's own action and an item added straight to the CRM's Deals pipeline), so
 * both stay in step: the row and its audit entry, then the move to where it
 * starts through setSponsorshipStatus (a start at Received books the money
 * the same way a move there does). Unless it came from the CRM, the CRM item
 * follows it (the CRM links its own item itself).
 *
 * The caller has checked finance.manage; RLS allows the writes only to the
 * organization's finance roles.
 */

export interface NewSponsorship {
  sponsorId: string;
  budgetPeriodId: string;
  type?: SponsorshipType;
  amountCents: number;
  tier?: string | null;
  deliverables?: string | null;
  expectedOn?: Date | null;
  ownerId: string;
  /** Where it starts (Prospect unless said). */
  status?: SponsorshipStatus;
}

export async function createSponsorshipRecord(
  ctx: SponsorshipActor,
  input: NewSponsorship,
  options: { fromCrm?: boolean } = {},
): Promise<{ error?: string; sponsorshipId?: string }> {
  const { db, organizationId } = ctx;
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { error: "Amount must be greater than zero." };
  const created = await db.sponsorship.create({
    data: {
      organizationId,
      sponsorId: input.sponsorId,
      budgetPeriodId: input.budgetPeriodId,
      type: input.type ?? SponsorshipType.CASH,
      amountCents: input.amountCents,
      tier: input.tier || null,
      deliverables: input.deliverables || null,
      expectedOn: input.expectedOn ?? null,
      ownerId: input.ownerId,
    },
  });
  await writeFinanceAuditLog(db, {
    organizationId,
    sponsorshipId: created.id,
    action: "SPONSORSHIP_CREATE",
    after: created,
  });
  if (input.status && input.status !== SponsorshipStatus.PROSPECT) {
    const moved = await setSponsorshipStatus(ctx, created.id, input.status, options);
    if (moved.error) return moved;
  } else if (!options.fromCrm) {
    // The CRM's Deals pipeline shows it too (when the CRM has one).
    await syncDealFromSponsorship(db, organizationId, ctx.userId, created.id);
  }
  return { sponsorshipId: created.id };
}
