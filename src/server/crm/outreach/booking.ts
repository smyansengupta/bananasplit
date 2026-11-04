import type { Prisma } from "@/generated/prisma/client";
import { normalizeEmail } from "@/lib/crm/dedupe";
import { splitName } from "@/lib/crm/fields";
import { orgLogoUrl } from "@/lib/org-logo";
import {
  bookingSlots,
  bookingSlug,
  pickHost,
  readBusyDates,
  readQuestions,
  SLUG_RE,
  type BookingQuestion,
  type Slot,
} from "@/lib/crm/outreach/booking";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { createEvent } from "@/server/events/service";
import { crmRecordHref } from "@/lib/crm/href";

import { CrmError, requireMember, type CrmActor } from "../access";
import { logActivity } from "../activity";
import { createDeal } from "../deals";
import { emitCrmEvent } from "../events";
import { crmInbox } from "../inbox-notify";
import { createPerson } from "../people";
import { advanceTargets, stopEnrollments } from "./inbound";
import { publicTarget } from "./public";
import { queueEmail } from "./send";
import { randomToken } from "./tokens";

/**
 * Booking pages (/book/{slug}; docs/features/crm.md, module 5, "Booking
 * links"): times come from the hosts' availability (their busy hours in a
 * typical week and the one-off dates they can't make, through
 * app.crm_booking_busy) and the meetings already on
 * their calendars. Several hosts round-robin: a booking goes to whoever of
 * those free has had the fewest lately. Booking makes a Bananasplit
 * meeting (Meetings, the host's calendar), finds or adds the person, puts
 * the meeting on their timeline, optionally opens an item in a pipeline,
 * stops sequences that stop on booking, marks campaigns booked, tells the
 * host, confirms to the guest, and emits meeting.booked.
 */

export interface BookingPageInput {
  title?: string;
  description?: string | null;
  durationMin?: number;
  bufferMin?: number;
  hostIds?: string[];
  questions?: BookingQuestion[];
  pipelineId?: string | null;
  minNoticeHours?: number;
  maxDaysAhead?: number;
  active?: boolean;
  slug?: string;
}

export async function createBookingPage(actor: CrmActor, title: string): Promise<{ id: string; slug: string }> {
  const t = title.trim().slice(0, 120) || "Meet with us";
  const slug = bookingSlug(t, randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x"));
  return actor.db.crmBookingPage.create({
    data: {
      organizationId: actor.organizationId,
      slug,
      title: t,
      hostIds: [actor.userId],
      questions: [{ id: "q1", label: "What would you like to talk about?", required: false }],
      createdById: actor.userId,
    },
    select: { id: true, slug: true },
  });
}

export async function updateBookingPage(actor: CrmActor, id: string, input: BookingPageInput): Promise<void> {
  const { db, organizationId } = actor;
  const page = await db.crmBookingPage.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!page) throw new CrmError("That booking page isn't here any more.");
  const data: Prisma.CrmBookingPageUpdateInput = {};
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, 120);
    if (!t) throw new CrmError("Give it a title.", ["title"]);
    data.title = t;
  }
  if (input.description !== undefined) data.description = input.description?.trim().slice(0, 2000) || null;
  if (input.durationMin !== undefined) {
    if (![15, 20, 30, 45, 60, 90].includes(input.durationMin)) throw new CrmError("Pick how long.");
    data.durationMin = input.durationMin;
  }
  if (input.bufferMin !== undefined) data.bufferMin = Math.min(Math.max(Math.round(input.bufferMin), 0), 60);
  if (input.minNoticeHours !== undefined) data.minNoticeHours = Math.min(Math.max(Math.round(input.minNoticeHours), 0), 168);
  if (input.maxDaysAhead !== undefined) data.maxDaysAhead = Math.min(Math.max(Math.round(input.maxDaysAhead), 1), 90);
  if (input.active !== undefined) data.active = input.active;
  if (input.hostIds) {
    const hosts = [...new Set(input.hostIds)].slice(0, 20);
    if (hosts.length === 0) throw new CrmError("Someone has to host it.");
    for (const h of hosts) await requireMember(db, organizationId, h);
    data.hostIds = hosts;
  }
  if (input.questions) data.questions = readQuestions(input.questions) as unknown as Prisma.InputJsonArray;
  if (input.pipelineId !== undefined) {
    if (input.pipelineId) {
      const p = await db.crmPipeline.findFirst({ where: { id: input.pipelineId, organizationId, archivedAt: null }, select: { id: true } });
      if (!p) throw new CrmError("Pick a pipeline.");
    }
    data.pipelineId = input.pipelineId || null;
  }
  if (input.slug !== undefined) {
    const s = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) throw new CrmError("Use 3 to 48 lowercase letters, numbers and dashes.", ["slug"]);
    const taken = await db.crmBookingPage.findFirst({ where: { slug: s, id: { not: id } }, select: { id: true } });
    if (taken) throw new CrmError("That link is taken.", ["slug"]);
    data.slug = s;
  }
  await db.crmBookingPage.update({ where: { id: page.id }, data });
}

// ---- The public page ---------------------------------------------------------------

export interface PublicBooking {
  organizationId: string;
  pageId: string;
  orgName: string;
  /** The organization's logo, or null for its initials. */
  logoUrl: string | null;
  title: string;
  description: string | null;
  durationMin: number;
  tz: string;
  hosts: { id: string; name: string }[];
  questions: BookingQuestion[];
  slots: Slot[];
}

async function slotsFor(db: TxClient, organizationId: string, page: { id: string; hostIds: string[]; durationMin: number; bufferMin: number; minNoticeHours: number; maxDaysAhead: number }, tz: string, now: Date) {
  const busy = await db.$queryRaw<{ userId: string; busy: string[]; dates: unknown }[]>`
    SELECT "userId", "busy", "dates" FROM app.crm_booking_busy(${page.id})`;
  const until = new Date(now.getTime() + (page.maxDaysAhead + 1) * 86_400_000);
  const hosts = page.hostIds.filter((h) => busy.some((b) => b.userId === h));
  const attending = await db.eventAttendee.findMany({
    where: {
      organizationId,
      userId: { in: hosts },
      rsvp: { not: "NO" },
      event: { deletedAt: null, endsAt: { gt: now }, startsAt: { lt: until } },
    },
    select: { userId: true, event: { select: { startsAt: true, endsAt: true, allDay: true } } },
    take: 2000,
  });
  const hosting = await db.event.findMany({
    where: { organizationId, hostUserId: { in: hosts }, deletedAt: null, endsAt: { gt: now }, startsAt: { lt: until } },
    select: { hostUserId: true, startsAt: true, endsAt: true, allDay: true },
    take: 2000,
  });
  return bookingSlots({
    now,
    tz,
    durationMin: page.durationMin,
    bufferMin: page.bufferMin,
    minNoticeHours: page.minNoticeHours,
    maxDaysAhead: page.maxDaysAhead,
    hosts: hosts.map((h) => ({
      userId: h,
      busy: busy.find((b) => b.userId === h)?.busy ?? [],
      // Set their availability: bookable when it doesn't say they're busy, not only weekdays 9 to 5.
      ownHours: (busy.find((b) => b.userId === h)?.busy.length ?? 0) > 0,
      // One-off dates they can't make: a day off, or some hours that day.
      dates: readBusyDates(busy.find((b) => b.userId === h)?.dates),
      events: [
        ...attending.filter((a) => a.userId === h && !a.event.allDay).map((a) => ({ start: a.event.startsAt, end: a.event.endsAt })),
        ...hosting.filter((e) => e.hostUserId === h && !e.allDay).map((e) => ({ start: e.startsAt, end: e.endsAt })),
      ],
    })),
  });
}

export async function loadBooking(slug: string, now: Date = new Date()): Promise<PublicBooking | null> {
  if (!SLUG_RE.test(slug)) return null;
  const target = await publicTarget("booking", slug);
  if (!target) return null;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const page = await db.crmBookingPage.findFirst({ where: { id: target.id, organizationId: target.organizationId, active: true } });
    if (!page) return null;
    const org = await db.organization.findUnique({ where: { id: target.organizationId }, select: { name: true, timezone: true, logo: true } });
    const members = await db.membership.findMany({
      where: { organizationId: target.organizationId, userId: { in: page.hostIds } },
      select: { userId: true, user: { select: { name: true } } },
    });
    const tz = org?.timezone ?? "UTC";
    return {
      organizationId: target.organizationId,
      pageId: page.id,
      orgName: org?.name ?? "",
      logoUrl: orgLogoUrl(org?.logo, 128),
      title: page.title,
      description: page.description,
      durationMin: page.durationMin,
      tz,
      hosts: members.map((m) => ({ id: m.userId, name: m.user.name ?? "A member" })),
      questions: readQuestions(page.questions),
      slots: await slotsFor(db, target.organizationId, page, tz, now),
    };
  });
}

export interface BookInput {
  start: string;
  name: string;
  email: string;
  answers: Record<string, string>;
}

export type BookResult = { ok: true; when: string; hostName: string } | { ok: false; error: string };

export async function book(slug: string, input: BookInput, now: Date = new Date()): Promise<BookResult> {
  if (!SLUG_RE.test(slug)) return { ok: false, error: "This booking page isn't open." };
  const email = normalizeEmail(input.email);
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Add your name." };
  if (!email) return { ok: false, error: "Add an email address we can confirm to." };
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a time." };
  const target = await publicTarget("booking", slug);
  if (!target) return { ok: false, error: "This booking page isn't open." };
  const orgId = target.organizationId;
  // Who hosts it: decided first (round-robin), then the meeting is made as them.
  const picked = await withSystemOrgTx(orgId, async ({ db }) => {
    const page = await db.crmBookingPage.findFirst({ where: { id: target.id, organizationId: orgId, active: true } });
    if (!page) return { error: "This booking page isn't open." } as const;
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
    const slots = await slotsFor(db, orgId, page, org?.timezone ?? "UTC", now);
    const slot = slots.find((s) => s.start.getTime() === start.getTime());
    if (!slot) return { error: "That time was just taken. Pick another." } as const;
    const questions = readQuestions(page.questions);
    for (const q of questions) {
      if (q.required && !input.answers[q.id]?.trim()) return { error: `Answer "${q.label}".` } as const;
    }
    const recent = await db.crmActivity.findMany({
      where: { organizationId: orgId, sourceKind: "event", createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) }, meta: { path: ["bookingPageId"], equals: page.id } },
      select: { actorId: true },
      take: 1000,
    });
    const load = new Map<string, number>();
    for (const r of recent) if (r.actorId) load.set(r.actorId, (load.get(r.actorId) ?? 0) + 1);
    const hostId = pickHost(slot.hostIds, load);
    if (!hostId) return { error: "That time was just taken. Pick another." } as const;
    return { page, slot, hostId, questions } as const;
  });
  if ("error" in picked) return { ok: false, error: picked.error! };
  const { page, slot, hostId, questions } = picked;
  const answers = questions
    .map((q) => ({ q: q.label, a: input.answers[q.id]?.trim().slice(0, 2000) ?? "" }))
    .filter((x) => x.a);
  const result = await withSystemOrgTx(orgId, { userId: hostId }, async (ctx) => {
    const { db } = ctx;
    const host = await db.membership.findFirst({
      where: { organizationId: orgId, userId: hostId },
      select: { role: true, user: { select: { name: true } } },
    });
    if (!host) return { ok: false as const, error: "That time was just taken. Pick another." };
    const actor: CrmActor = { db, organizationId: orgId, userId: hostId, role: host.role };
    // The person: by address, else a new one owned by the host.
    const existing = await db.crmPersonEmail.findFirst({
      where: { organizationId: orgId, email, person: { deletedAt: null } },
      select: { personId: true },
    });
    let personId = existing?.personId ?? null;
    if (!personId) {
      const parts = splitName(name);
      personId = (
        await createPerson(
          actor,
          { name, firstName: parts.firstName, lastName: parts.lastName, primaryEmail: email, source: "booking", sourceDetail: page.title, ownerId: hostId },
          { trusted: true, source: "system" },
        )
      ).id;
    }
    const description = [`Booked through ${page.title} by ${name} (${email}).`, ...answers.map((x) => `${x.q}\n${x.a}`)].join("\n\n");
    const { event } = await createEvent(
      { db, organizationId: orgId, userId: hostId, role: host.role, kind: "system" },
      {
        title: `${page.title} with ${name}`.slice(0, 200),
        description,
        startsAt: slot.start,
        endsAt: slot.end,
        hostUserId: hostId,
      },
    );
    await db.eventAttendee.upsert({
      where: { eventId_userId: { eventId: event.id, userId: hostId } },
      create: { organizationId: orgId, eventId: event.id, userId: hostId, rsvp: "YES" },
      update: { rsvp: "YES" },
    });
    const person = await db.crmPerson.findFirst({ where: { id: personId, organizationId: orgId }, select: { companyId: true } });
    let dealId: string | null = null;
    if (page.pipelineId) {
      dealId = (
        await createDeal(
          actor,
          { pipelineId: page.pipelineId, title: `${name}: ${page.title}`, primaryPersonId: personId, companyId: person?.companyId ?? null, ownerId: hostId, source: "booking", nextStep: page.title, nextStepAt: slot.start },
          { trusted: true, source: "system" },
        ).catch(() => ({ id: null as string | null }))
      ).id;
    }
    // The same row the workspace mirror makes for this meeting (sourceKind event).
    await logActivity(db, {
      organizationId: orgId,
      kind: "MEETING",
      subject: `${page.title} with ${name}`,
      body: answers.map((x) => `${x.q}: ${x.a}`).join("\n") || null,
      occurredAt: slot.start,
      targets: [
        { kind: "person", id: personId },
        ...(person?.companyId ? [{ kind: "company" as const, id: person.companyId }] : []),
        ...(dealId ? [{ kind: "deal" as const, id: dealId }] : []),
      ],
      actorId: hostId,
      sourceKind: "event",
      sourceId: event.id,
      meta: { bookingPageId: page.id, eventKind: "OTHER", booked: true },
    });
    await stopEnrollments(db, orgId, personId, "BOOKED", "they booked a meeting");
    await advanceTargets(db, orgId, personId, "BOOKED");
    await emitCrmEvent(db, orgId, { type: "meeting.booked", targetKind: "person", targetId: personId, sourceId: event.id, source: "system" });
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { slug: true, name: true, timezone: true } });
    const when = slot.start.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: org?.timezone ?? "UTC",
      timeZoneName: "short",
    });
    // The host's Inbox, linked to the person's card (the meeting is on it).
    await crmInbox(db, orgId, [hostId], {
      type: "CRM_BOOKED",
      group: "booked",
      title: `${name} booked ${page.title}`,
      body: when,
      linkUrl: org ? crmRecordHref(org.slug, "person", personId) : null,
      many: (n) => ({ title: `${n} new bookings`, linkUrl: org ? `/app/${org.slug}/meetings` : null }),
      latest: `Latest: ${name}, ${when}`,
      key: `booking-${event.id}`,
    });
    // The guest's confirmation, from the host. Kept automatic: it's the
    // receipt for what the guest just did themselves, to them alone, and
    // says only what they booked (no outreach goes out without a person).
    await queueEmail(db, {
      organizationId: orgId,
      senderId: hostId,
      createdById: null,
      personId,
      subject: `Booked: ${page.title}, ${when}`,
      body: `Hi ${name.split(" ")[0]},\n\nYou're booked: ${page.title} with ${host.user.name ?? org?.name ?? "us"}, ${when} (${page.durationMin} minutes).\n\nIf you need to change it, reply to this email.\n\n${host.user.name ?? ""}`.trim(),
      track: false,
    }).catch(() => undefined);
    return { ok: true as const, when, hostName: host.user.name ?? "your host" };
  });
  return result;
}
