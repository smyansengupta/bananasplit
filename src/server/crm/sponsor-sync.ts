import { normalizeEmail } from "@/lib/crm/dedupe";
import { personName, splitName } from "@/lib/crm/fields";
import type { TxClient } from "@/server/db/context";

import { writeHistory } from "./history";

/**
 * Keeping Finance › Deals and the CRM's Deals pipeline the same (docs/
 * features/crm.md, "Moving Finance deals in"). A Sponsor (a partner on
 * screen) is a CrmCompany (sponsorId), its contact a CrmPerson, and each
 * Sponsorship (a deal on screen) a CrmDeal
 * (sponsorshipId) in the pipeline made from the "sponsors" template, at the
 * stage whose key is the sponsorship's status.
 *
 * Finance stays the source of truth for money: a CRM stage move goes
 * through Finance's setSponsorshipStatus (src/server/finance/
 * sponsorship-status.ts), which books the transaction and then calls back
 * here. Everything here is idempotent, and runs inside a savepoint: if the
 * CRM side can't be written (the CRM was never set up, the person can't see
 * that item under OWN access), Finance's own change still commits.
 */

export interface SponsorshipsPipeline {
  id: string;
  currency: string;
  stages: { id: string; key: string | null; kind: string }[];
}

export async function sponsorshipsPipeline(
  db: TxClient,
  organizationId: string,
): Promise<SponsorshipsPipeline | null> {
  const p = await db.crmPipeline.findFirst({
    where: { organizationId, template: "sponsors", archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      currency: true,
      stages: { orderBy: { sortOrder: "asc" }, select: { id: true, key: true, kind: true } },
    },
  });
  return p;
}

/** Runs `fn` so its failure never undoes the caller's transaction. */
async function savepoint(db: TxClient, fn: () => Promise<void>): Promise<boolean> {
  await db.$executeRaw`SAVEPOINT crm_sponsor_sync`;
  try {
    await fn();
    await db.$executeRaw`RELEASE SAVEPOINT crm_sponsor_sync`;
    return true;
  } catch (error) {
    await db.$executeRaw`ROLLBACK TO SAVEPOINT crm_sponsor_sync`;
    if (process.env.NODE_ENV !== "production") console.warn("[crm] sponsorship sync skipped", error);
    return false;
  }
}

/**
 * The CRM company for a Finance sponsor (made if missing), with its contact
 * as a person. Returns the company and person ids.
 */
export async function companyForSponsor(
  db: TxClient,
  organizationId: string,
  userId: string | null,
  sponsorId: string,
): Promise<{ companyId: string; personId: string | null } | null> {
  const sponsor = await db.sponsor.findFirst({
    where: { id: sponsorId, organizationId },
    select: { id: true, name: true, contactName: true, contactEmail: true, notes: true },
  });
  if (!sponsor) return null;
  let company = await db.crmCompany.findFirst({
    where: { organizationId, sponsorId: sponsor.id },
    select: { id: true },
  });
  if (!company) {
    // A company of the same name already in the CRM is the same partner.
    const sameName = await db.crmCompany.findFirst({
      where: {
        organizationId,
        sponsorId: null,
        deletedAt: null,
        name: { equals: sponsor.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (sameName) {
      company = await db.crmCompany.update({
        where: { id: sameName.id },
        data: { sponsorId: sponsor.id },
        select: { id: true },
      });
    } else {
      company = await db.crmCompany.create({
        data: {
          organizationId,
          name: sponsor.name.slice(0, 200),
          description: sponsor.notes?.slice(0, 5000) ?? null,
          sponsorId: sponsor.id,
          createdById: userId,
          updatedById: userId,
          ownerId: userId,
        },
        select: { id: true },
      });
      await writeHistory(db, {
        organizationId,
        targetKind: "company",
        targetId: company.id,
        changes: [{ field: "created", oldValue: null, newValue: sponsor.name }],
        userId,
        source: "finance",
      });
    }
  }
  let personId: string | null = null;
  const email = normalizeEmail(sponsor.contactEmail);
  if (email) {
    const known = await db.crmPersonEmail.findFirst({
      where: { organizationId, email },
      select: { personId: true },
    });
    personId = known?.personId ?? null;
  }
  if (!personId && sponsor.contactName?.trim()) {
    const known = await db.crmPerson.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        companyId: company.id,
        name: { equals: sponsor.contactName.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    personId = known?.id ?? null;
  }
  if (!personId && (email || sponsor.contactName?.trim())) {
    const name = personName({ name: sponsor.contactName, email });
    const parts = splitName(name);
    const person = await db.crmPerson.create({
      data: {
        organizationId,
        name,
        firstName: parts.firstName,
        lastName: parts.lastName,
        primaryEmail: email,
        companyId: company.id,
        relationship: "partner",
        source: "finance",
        sourceDetail: "A Finance partner's contact",
        ownerId: userId,
        createdById: userId,
        updatedById: userId,
      },
      select: { id: true },
    });
    personId = person.id;
    if (email) {
      await db.crmPersonEmail.create({
        data: { organizationId, personId, email, isPrimary: true },
      });
    }
    await db.crmJob.create({
      data: { organizationId, personId, companyId: company.id, companyName: sponsor.name, current: true },
    });
  }
  return { companyId: company.id, personId };
}

/**
 * Makes or updates the CRM item for one sponsorship: its stage (by key),
 * amount, expected date and owner. A no-op without a Deals pipeline.
 */
export async function syncDealFromSponsorship(
  db: TxClient,
  organizationId: string,
  userId: string | null,
  sponsorshipId: string,
): Promise<boolean> {
  const pipeline = await sponsorshipsPipeline(db, organizationId);
  if (!pipeline) return false;
  return savepoint(db, async () => {
    const s = await db.sponsorship.findFirst({
      where: { id: sponsorshipId, organizationId },
      select: {
        id: true,
        sponsorId: true,
        status: true,
        amountCents: true,
        expectedOn: true,
        ownerId: true,
        tier: true,
        type: true,
        createdAt: true,
        sponsor: { select: { name: true } },
      },
    });
    if (!s) return;
    const stage = pipeline.stages.find((st) => st.key === s.status) ?? pipeline.stages[0];
    if (!stage) return;
    const closed = stage.kind !== "OPEN";
    const existing = await db.crmDeal.findFirst({
      where: { organizationId, sponsorshipId: s.id },
      select: { id: true, stageId: true, amountCents: true, closedAt: true },
    });
    if (existing) {
      const moved = existing.stageId !== stage.id;
      await db.crmDeal.updateMany({
        where: { id: existing.id, organizationId },
        data: {
          stageId: stage.id,
          amountCents: s.amountCents,
          expectedOn: s.expectedOn,
          ownerId: s.ownerId,
          ...(moved ? { stageEnteredAt: new Date(), closedAt: closed ? new Date() : null } : {}),
          updatedById: userId,
        },
      });
      if (moved) {
        await writeHistory(db, {
          organizationId,
          targetKind: "deal",
          targetId: existing.id,
          changes: [{ field: "stageId", oldValue: existing.stageId, newValue: stage.id }],
          userId,
          source: "finance",
        });
      }
      return;
    }
    const company = await companyForSponsor(db, organizationId, userId, s.sponsorId);
    const deal = await db.crmDeal.create({
      data: {
        organizationId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: `${s.sponsor.name}${s.tier ? ` ${s.tier}` : ""}`.slice(0, 200),
        amountCents: s.amountCents,
        currency: pipeline.currency,
        expectedOn: s.expectedOn,
        closedAt: closed ? new Date() : null,
        ownerId: s.ownerId,
        companyId: company?.companyId ?? null,
        primaryPersonId: company?.personId ?? null,
        sponsorshipId: s.id,
        source: s.type === "CREDITS" ? "finance credits" : "finance",
        createdById: userId,
        updatedById: userId,
      },
      select: { id: true },
    });
    if (company?.personId) {
      await db.crmDealPerson.create({
        data: { organizationId, dealId: deal.id, personId: company.personId, role: "contact" },
      });
    }
    await writeHistory(db, {
      organizationId,
      targetKind: "deal",
      targetId: deal.id,
      changes: [{ field: "created", oldValue: null, newValue: "From Finance" }],
      userId,
      source: "finance",
    });
  });
}

/** A deal deleted in Finance: its CRM item goes to the trash, unlinked. */
export async function dropDealForSponsorship(
  db: TxClient,
  organizationId: string,
  userId: string | null,
  sponsorshipId: string,
): Promise<void> {
  await savepoint(db, async () => {
    await db.crmDeal.updateMany({
      where: { organizationId, sponsorshipId },
      data: { sponsorshipId: null, deletedAt: new Date(), updatedById: userId },
    });
  });
}
