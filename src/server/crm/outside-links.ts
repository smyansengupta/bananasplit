import { normalizeEmail } from "@/lib/crm/dedupe";
import { crmRecordHref } from "@/lib/crm/href";

import { crmAccess, type CrmActor } from "./access";

/**
 * Links into the CRM from the rest of the app (Finance's deals, a meeting's
 * attendees, a member's profile): which records they are in the CRM, as
 * the viewer may see them. Nothing when the space hasn't added the CRM or
 * its plan lacks it; the database hides records a member on "members see
 * their own" can't open, so a link never leads to a card they can't read.
 */

/** The CRM is there for this viewer: added, and on the plan. */
export async function crmOpenFor(actor: CrmActor): Promise<boolean> {
  const access = await crmAccess(actor);
  return access.added && access.onPlan;
}

/**
 * Finance's deals and partners in the CRM: a deal (Sponsorship) is a CRM
 * deal (CrmDeal.sponsorshipId); a partner (Sponsor) is a CRM company
 * (CrmCompany.sponsorId) or, with no company, the CRM person with its
 * contact's email. Keyed by the Finance id.
 */
export async function financeCrmLinks(
  actor: CrmActor,
  orgSlug: string,
  input: {
    sponsors: readonly { id: string; contactEmail?: string | null }[];
    sponsorshipIds: readonly string[];
  },
): Promise<{ partners: Record<string, string>; deals: Record<string, string> }> {
  const partners: Record<string, string> = {};
  const deals: Record<string, string> = {};
  if (!(await crmOpenFor(actor))) return { partners, deals };
  const { db, organizationId } = actor;
  const sponsorIds = input.sponsors.map((s) => s.id);
  if (sponsorIds.length) {
    const companies = await db.crmCompany.findMany({
      where: { organizationId, deletedAt: null, sponsorId: { in: sponsorIds } },
      select: { id: true, sponsorId: true },
    });
    for (const c of companies) {
      if (c.sponsorId) partners[c.sponsorId] = crmRecordHref(orgSlug, "company", c.id);
    }
    const byEmail = new Map<string, string[]>();
    for (const s of input.sponsors) {
      if (partners[s.id] || !s.contactEmail) continue;
      const email = normalizeEmail(s.contactEmail);
      if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), s.id]);
    }
    const people = await crmPeopleByEmail(actor, orgSlug, [...byEmail.keys()], { checked: true });
    for (const [email, href] of Object.entries(people)) {
      for (const id of byEmail.get(email) ?? []) partners[id] = href;
    }
  }
  if (input.sponsorshipIds.length) {
    const rows = await db.crmDeal.findMany({
      where: { organizationId, deletedAt: null, sponsorshipId: { in: [...input.sponsorshipIds] } },
      select: { id: true, sponsorshipId: true },
    });
    for (const d of rows) {
      if (d.sponsorshipId) deals[d.sponsorshipId] = crmRecordHref(orgSlug, "deal", d.id);
    }
  }
  return { partners, deals };
}

/**
 * The CRM people with these emails (any of a person's addresses, compared
 * normalized), as links to their cards, keyed by the normalized email.
 * `checked` skips the access check when the caller already made it.
 */
export async function crmPeopleByEmail(
  actor: CrmActor,
  orgSlug: string,
  emails: readonly string[],
  options: { checked?: boolean } = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const wanted = [...new Set(emails.map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e)))];
  if (!wanted.length) return out;
  if (!options.checked && !(await crmOpenFor(actor))) return out;
  const rows = await actor.db.crmPersonEmail.findMany({
    where: {
      organizationId: actor.organizationId,
      email: { in: wanted.slice(0, 500) },
      person: { deletedAt: null },
    },
    select: { email: true, personId: true },
  });
  for (const r of rows) out[r.email] = crmRecordHref(orgSlug, "person", r.personId);
  return out;
}

/**
 * The CRM person who is this member: linked to their account
 * (CrmPerson.userId), else one of their addresses. Null when there's none,
 * or the CRM isn't there for the viewer.
 */
export async function crmPersonForMember(
  actor: CrmActor,
  orgSlug: string,
  userId: string,
): Promise<string | null> {
  if (!(await crmOpenFor(actor))) return null;
  const linked = await actor.db.crmPerson.findFirst({
    where: { organizationId: actor.organizationId, userId, deletedAt: null },
    select: { id: true },
  });
  if (linked) return crmRecordHref(orgSlug, "person", linked.id);
  // Their address is only matched here, never shown.
  const user = await actor.db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) return null;
  const byEmail = await crmPeopleByEmail(actor, orgSlug, [user.email], { checked: true });
  return Object.values(byEmail)[0] ?? null;
}

/**
 * A meeting's people in the CRM: its member attendees who are CRM people
 * (by account, else by email), keyed by user id; and the CRM people it was
 * with who aren't members (a booking's guest, a person the meeting is
 * logged on or linked to), each with its card.
 */
export async function crmForMeeting(
  actor: CrmActor,
  orgSlug: string,
  eventId: string,
  attendeeIds: readonly string[],
): Promise<{
  attendees: Record<string, string>;
  guests: { id: string; name: string; detail: string | null; href: string }[];
}> {
  const attendees: Record<string, string> = {};
  const guests: { id: string; name: string; detail: string | null; href: string }[] = [];
  if (!(await crmOpenFor(actor))) return { attendees, guests };
  const { db, organizationId } = actor;
  const members = [...new Set(attendeeIds)];
  const memberPeople = new Set<string>();
  if (members.length) {
    const linked = await db.crmPerson.findMany({
      where: { organizationId, deletedAt: null, userId: { in: members } },
      select: { id: true, userId: true },
    });
    for (const p of linked) {
      if (!p.userId || attendees[p.userId]) continue;
      attendees[p.userId] = crmRecordHref(orgSlug, "person", p.id);
      memberPeople.add(p.id);
    }
    const rest = members.filter((id) => !attendees[id]);
    if (rest.length) {
      const users = await db.user.findMany({
        where: { id: { in: rest } },
        select: { id: true, email: true },
      });
      const emails = users.flatMap((u) => {
        const e = normalizeEmail(u.email);
        return e ? [{ id: u.id, email: e }] : [];
      });
      if (emails.length) {
        const rows = await db.crmPersonEmail.findMany({
          where: {
            organizationId,
            email: { in: emails.map((e) => e.email) },
            person: { deletedAt: null },
          },
          select: { email: true, personId: true },
        });
        const byEmail = new Map(rows.map((r) => [r.email, r.personId]));
        for (const u of emails) {
          const personId = byEmail.get(u.email);
          if (!personId) continue;
          attendees[u.id] = crmRecordHref(orgSlug, "person", personId);
          memberPeople.add(personId);
        }
      }
    }
  }
  // Who else: the person a booking (or the mirror) logged this meeting on,
  // and anyone linked to it.
  const activity = await db.crmActivity.findFirst({
    where: { organizationId, sourceKind: "event", sourceId: eventId, deletedAt: null },
    select: { targets: { where: { targetKind: "person" }, select: { targetId: true } } },
  });
  const links = await db.itemLink.findMany({
    where: {
      organizationId,
      OR: [
        { fromKind: "event", fromId: eventId, toKind: "crm-person" },
        { toKind: "event", toId: eventId, fromKind: "crm-person" },
      ],
    },
    select: { fromKind: true, fromId: true, toId: true },
    take: 50,
  });
  const ids = [
    ...new Set([
      ...(activity?.targets.map((t) => t.targetId) ?? []),
      ...links.map((l) => (l.fromKind === "crm-person" ? l.fromId : l.toId)),
    ]),
  ].filter((id) => !memberPeople.has(id));
  if (ids.length) {
    const people = await db.crmPerson.findMany({
      where: { organizationId, id: { in: ids.slice(0, 50) }, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, title: true, company: { select: { name: true } } },
    });
    for (const p of people) {
      guests.push({
        id: p.id,
        name: p.name,
        detail: [p.title, p.company?.name].filter(Boolean).join(", ") || null,
        href: crmRecordHref(orgSlug, "person", p.id),
      });
    }
  }
  return { attendees, guests };
}
