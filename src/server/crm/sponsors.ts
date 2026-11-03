import { CrmError, type CrmActor } from "./access";
import { companyForSponsor, sponsorshipsPipeline, syncDealFromSponsorship } from "./sponsor-sync";

/**
 * Moving Sponsors in (docs/features/crm.md): every Finance Sponsor becomes
 * a CRM company (its contact a person), every Sponsorship an item in the
 * Sponsorships pipeline at the stage of its status. Idempotent: running it
 * again links what's new and moves nothing twice (CrmCompany.sponsorId and
 * CrmDeal.sponsorshipId are unique). Finance keeps working as before; the
 * two stay in step through src/server/crm/sponsor-sync.ts.
 */

export interface SponsorsMoveResult {
  companies: number;
  items: number;
}

export async function moveSponsorsIn(actor: CrmActor): Promise<SponsorsMoveResult> {
  const { db, organizationId, userId } = actor;
  const pipeline = await sponsorshipsPipeline(db, organizationId);
  if (!pipeline) throw new CrmError("Add the Sponsorships pipeline first.");
  const sponsors = await db.sponsor.findMany({
    where: { organizationId },
    select: { id: true },
    orderBy: { name: "asc" },
    take: 5000,
  });
  const before = await db.crmCompany.count({ where: { organizationId, sponsorId: { not: null } } });
  for (const s of sponsors) {
    await companyForSponsor(db, organizationId, userId, s.id);
  }
  const after = await db.crmCompany.count({ where: { organizationId, sponsorId: { not: null } } });
  const sponsorships = await db.sponsorship.findMany({
    where: { organizationId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 10_000,
  });
  const itemsBefore = await db.crmDeal.count({ where: { organizationId, sponsorshipId: { not: null } } });
  for (const s of sponsorships) {
    await syncDealFromSponsorship(db, organizationId, userId, s.id);
  }
  const itemsAfter = await db.crmDeal.count({ where: { organizationId, sponsorshipId: { not: null } } });
  return { companies: after - before, items: itemsAfter - itemsBefore };
}
