import type { FieldDef } from "@/lib/databases/fields";
import { knowsBest } from "@/lib/crm/strength";
import { linkedFrom, type LinkedGroup } from "@/server/databases/relations";
import type { TxClient } from "@/server/db/context";

import { timeline, type TimelineEntry } from "./activity";
import { customFieldsFor } from "./databases";
import { historyOf, type HistoryEntry } from "./history";
import { touchpointsOf } from "./strength";

/**
 * Everything a record page shows, read in the viewer's transaction (RLS
 * decides; null when they can't see it). The timeline is the first page;
 * the page loads older entries on demand.
 */

export interface RecordExtras {
  fields: FieldDef[];
  timeline: TimelineEntry[];
  history: HistoryEntry[];
  linkedFrom: LinkedGroup[];
  knowsBest: { userId: string; strength: number }[];
}

export async function extras(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  kind: "person" | "company" | "deal",
  id: string,
  pipelineId?: string,
): Promise<RecordExtras> {
  const fields = await customFieldsFor(db, organizationId, kind, pipelineId);
  const tl = await timeline(db, organizationId, { kind, id }, { take: 50 });
  const history = await historyOf(db, organizationId, kind, id, 200);
  const linked = await linkedFrom(db, organizationId, orgSlug, { kind, id }).catch(() => []);
  const touches = kind === "deal" ? [] : await touchpointsOf(db, organizationId, kind, id);
  return { fields, timeline: tl, history, linkedFrom: linked, knowsBest: knowsBest(touches) };
}

export async function loadPerson(db: TxClient, organizationId: string, orgSlug: string, id: string) {
  const core = await loadPersonCore(db, organizationId, id);
  return core && { ...core, ...(await extras(db, organizationId, orgSlug, "person", id)) };
}

/** A person without their timeline and the rest of `extras`, which can load beside it. */
export async function loadPersonCore(db: TxClient, organizationId: string, id: string) {
  const person = await db.crmPerson.findFirst({
    where: { id, organizationId },
    include: {
      company: { select: { id: true, name: true, domain: true, sponsorId: true } },
      emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { email: true, isPrimary: true } },
      jobs: {
        orderBy: [{ current: "desc" }, { startedOn: { sort: "desc", nulls: "last" } }],
        select: { id: true, companyId: true, companyName: true, title: true, startedOn: true, endedOn: true, current: true },
      },
      deals: {
        select: {
          role: true,
          deal: {
            select: {
              id: true,
              title: true,
              amountCents: true,
              currency: true,
              deletedAt: true,
              closedAt: true,
              stage: { select: { name: true, kind: true } },
              pipeline: { select: { id: true, name: true, itemNoun: true } },
            },
          },
        },
      },
    },
  });
  if (!person) return null;
  const contact = person.contactId
    ? await db.contact.findFirst({
        where: { id: person.contactId, organizationId },
        select: { sessionsAttended: true, lastCheckInAt: true, firstCheckInAt: true },
      })
    : null;
  return {
    person,
    contact,
    deals: person.deals.filter((d) => !d.deal.deletedAt),
  };
}

export async function loadCompany(db: TxClient, organizationId: string, orgSlug: string, id: string) {
  const company = await db.crmCompany.findFirst({ where: { id, organizationId } });
  if (!company) return null;
  const people = await db.crmPerson.findMany({
    where: { organizationId, companyId: id, deletedAt: null },
    orderBy: [{ strength: "desc" }, { name: "asc" }],
    take: 200,
    select: { id: true, name: true, title: true, primaryEmail: true, lastContactedAt: true, strength: true },
  });
  // People who used to work here (job history).
  const past = await db.crmJob.findMany({
    where: { organizationId, companyId: id, current: false },
    orderBy: { endedOn: { sort: "desc", nulls: "last" } },
    take: 50,
    select: { title: true, endedOn: true, person: { select: { id: true, name: true, deletedAt: true } } },
  });
  const deals = await db.crmDeal.findMany({
    where: { organizationId, companyId: id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      amountCents: true,
      currency: true,
      closedAt: true,
      stage: { select: { name: true, kind: true } },
      pipeline: { select: { id: true, name: true, itemNoun: true } },
    },
  });
  // Finance on the company: what its deals pledged and paid.
  const finance = company.sponsorId
    ? await db.sponsorship
        .findMany({
          where: { organizationId, sponsorId: company.sponsorId },
          select: { amountCents: true, status: true, type: true },
        })
        .catch(() => [])
    : [];
  const money = {
    pledged: finance.filter((s) => s.status !== "DECLINED" && s.status !== "WRITTEN_OFF").reduce((n, s) => n + s.amountCents, 0),
    received: finance.filter((s) => s.status === "RECEIVED" && s.type === "CASH").reduce((n, s) => n + s.amountCents, 0),
    count: finance.length,
  };
  return {
    company,
    people,
    past: past.filter((p) => !p.person.deletedAt),
    deals,
    money,
    ...(await extras(db, organizationId, orgSlug, "company", id)),
  };
}

export async function loadDeal(db: TxClient, organizationId: string, orgSlug: string, id: string) {
  const deal = await db.crmDeal.findFirst({
    where: { id, organizationId },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { sortOrder: "asc" } } } },
      company: { select: { id: true, name: true, domain: true } },
      people: {
        orderBy: { createdAt: "asc" },
        select: { role: true, person: { select: { id: true, name: true, title: true, primaryEmail: true, deletedAt: true } } },
      },
    },
  });
  if (!deal) return null;
  const sponsorship = deal.sponsorshipId
    ? await db.sponsorship
        .findFirst({
          where: { id: deal.sponsorshipId, organizationId },
          select: { status: true, type: true, transactionId: true, budgetPeriod: { select: { label: true } } },
        })
        .catch(() => null)
    : null;
  return {
    deal,
    people: deal.people.filter((p) => !p.person.deletedAt),
    sponsorship,
    ...(await extras(db, organizationId, orgSlug, "deal", id, deal.pipelineId)),
  };
}
