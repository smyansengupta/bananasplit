import { normalizeEmail } from "@/lib/crm/dedupe";
import { MEMBER_RELATIONSHIP } from "@/lib/crm/templates";
import type { TxClient } from "@/server/db/context";

import type { CrmActor } from "./access";
import { createPerson, personByEmail } from "./people";

/**
 * Bringing in the people Bananasplit already knows (docs/features/crm.md,
 * setup): members of the organization, the people who checked in or signed
 * up (Contact), and everyone who answered a form. Each becomes a person,
 * or links to the person who already has that address. In turns of
 * BATCH, so a big organization runs it as a job (crm-import, mode bring-in)
 * and nothing times out.
 */

export const BRING_IN_SOURCES = ["members", "contacts", "forms"] as const;
export type BringInSource = (typeof BRING_IN_SOURCES)[number];

export const BRING_IN_LABELS: Record<BringInSource, string> = {
  members: "Members",
  contacts: "People who checked in or signed up",
  forms: "People who answered a form",
};

export const BATCH = 200;

export interface BringInCounts {
  members: number;
  contacts: number;
  forms: number;
  sponsors: number;
}

/** How many of each aren't in the CRM yet (by address or link). */
export async function bringInCounts(db: TxClient, organizationId: string): Promise<BringInCounts> {
  const members = await countMembersSlow(db, organizationId);
  const contacts = await db.contact.count({
    where: {
      organizationId,
      emails: { some: {} },
      NOT: { id: { in: await linkedContactIds(db, organizationId) } },
    },
  });
  const forms = (await formEmails(db, organizationId, 5000)).length;
  const sponsors = await db.sponsor.count({
    where: { organizationId, NOT: { id: { in: await linkedSponsorIds(db, organizationId) } } },
  });
  return { members, contacts, forms, sponsors };
}

async function countMembersSlow(db: TxClient, organizationId: string): Promise<number> {
  const linked = new Set(
    (
      await db.crmPerson.findMany({
        where: { organizationId, userId: { not: null } },
        select: { userId: true },
      })
    ).map((p) => p.userId),
  );
  const all = await db.membership.findMany({ where: { organizationId }, select: { userId: true } });
  return all.filter((m) => !linked.has(m.userId)).length;
}

async function linkedContactIds(db: TxClient, organizationId: string): Promise<string[]> {
  return (
    await db.crmPerson.findMany({
      where: { organizationId, contactId: { not: null } },
      select: { contactId: true },
      take: 100_000,
    })
  ).map((p) => p.contactId!);
}

async function linkedSponsorIds(db: TxClient, organizationId: string): Promise<string[]> {
  return (
    await db.crmCompany.findMany({
      where: { organizationId, sponsorId: { not: null } },
      select: { sponsorId: true },
    })
  ).map((c) => c.sponsorId!);
}

/** Form respondents' addresses not yet in the CRM. */
async function formEmails(db: TxClient, organizationId: string, take: number): Promise<string[]> {
  const rows = await db.formResponse.findMany({
    where: { organizationId, email: { not: null } },
    select: { email: true },
    distinct: ["email"],
    take: take * 2,
  });
  const out: string[] = [];
  for (const r of rows) {
    const e = normalizeEmail(r.email);
    if (!e) continue;
    const known = await db.crmPersonEmail.findFirst({ where: { organizationId, email: e }, select: { id: true } });
    if (!known) out.push(e);
    if (out.length >= take) break;
  }
  return out;
}

export interface BringInResult {
  added: number;
  linked: number;
  /** More are waiting (run again, or let the job finish). */
  more: boolean;
}

export async function bringIn(actor: CrmActor, source: BringInSource): Promise<BringInResult> {
  const { db, organizationId } = actor;
  let added = 0;
  let linked = 0;
  const opts = { trusted: true, source: "import" as const };
  if (source === "members") {
    const taken = new Set(
      (
        await db.crmPerson.findMany({
          where: { organizationId, userId: { not: null } },
          select: { userId: true },
        })
      ).map((p) => p.userId),
    );
    const members = await db.membership.findMany({
      where: { organizationId },
      select: { userId: true, user: { select: { name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
      take: 5000,
    });
    const todo = members.filter((m) => !taken.has(m.userId));
    for (const m of todo.slice(0, BATCH)) {
      const email = normalizeEmail(m.user.email);
      const existing = email ? await personByEmail(db, organizationId, email) : null;
      if (existing && !existing.deletedAt) {
        await db.crmPerson.update({ where: { id: existing.id }, data: { userId: m.userId } });
        linked++;
        continue;
      }
      await createPerson(
        actor,
        {
          name: m.user.name ?? null,
          primaryEmail: email,
          relationship: MEMBER_RELATIONSHIP.id,
          source: "members",
          userId: m.userId,
        },
        opts,
      );
      added++;
    }
    return { added, linked, more: todo.length > BATCH };
  }
  if (source === "contacts") {
    const exclude = await linkedContactIds(db, organizationId);
    const contacts = await db.contact.findMany({
      where: { organizationId, emails: { some: {} }, NOT: { id: { in: exclude } } },
      select: {
        id: true,
        displayName: true,
        userId: true,
        lastCheckInAt: true,
        emails: { orderBy: { isPrimary: "desc" }, select: { emailNormalized: true } },
      },
      orderBy: { lastCheckInAt: { sort: "desc", nulls: "last" } },
      take: BATCH + 1,
    });
    for (const c of contacts.slice(0, BATCH)) {
      const email = normalizeEmail(c.emails[0]?.emailNormalized);
      const existing = email ? await personByEmail(db, organizationId, email) : null;
      if (existing && !existing.deletedAt) {
        await db.crmPerson.update({ where: { id: existing.id }, data: { contactId: c.id } });
        linked++;
        continue;
      }
      await createPerson(
        actor,
        {
          name: c.displayName,
          primaryEmail: email,
          otherEmails: c.emails.slice(1).map((e) => e.emailNormalized),
          source: "check-ins",
          contactId: c.id,
          userId: c.userId,
          ...(c.userId ? { relationship: MEMBER_RELATIONSHIP.id } : {}),
        },
        opts,
      );
      added++;
    }
    return { added, linked, more: contacts.length > BATCH };
  }
  const emails = await formEmails(db, organizationId, BATCH + 1);
  for (const email of emails.slice(0, BATCH)) {
    await createPerson(actor, { primaryEmail: email, source: "form" }, opts);
    added++;
  }
  return { added, linked, more: emails.length > BATCH };
}
