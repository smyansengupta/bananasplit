import { ConferenceProvider, Prisma, type Role } from "@/generated/prisma/client";
import { checkGuestName, cleanAnswer, withHost } from "@/lib/booking/guest";
import { offeredDurations } from "@/lib/booking/hours";
import { normalizeEmail } from "@/lib/crm/dedupe";
import { splitName } from "@/lib/crm/fields";
import { pickHost, readQuestions, SLUG_RE, type BookingQuestion } from "@/lib/crm/outreach/booking";
import { orgLogoUrl } from "@/lib/org-logo";
import { isValidTimeZone } from "@/lib/tasks/dates";
import { logActivity } from "@/server/crm/activity";
import type { CrmActor } from "@/server/crm/access";
import { createDeal } from "@/server/crm/deals";
import { emitCrmEvent } from "@/server/crm/events";
import { advanceTargets, stopEnrollments } from "@/server/crm/outreach/inbound";
import { publicTarget } from "@/server/crm/outreach/public";
import { createPerson } from "@/server/crm/people";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { createEvent, deleteEvent, updateEvent, type EventServiceContext } from "@/server/events/service";

import { bookingAccess, connectedVideo } from "./access";
import { emailGuest, tellHosts, whenText } from "./notify";
import { liveHosts, pageTimeZone, slotsFor } from "./slots";
import { BOOKING_TOKEN_RE, bookingToken, newBookingId, tokenHash } from "./token";

/**
 * The public side of booking links (/book/{slug} and the guest's own
 * /book/m/{token}; docs/features/booking.md). Found without an organization
 * context (app.crm_public_target), then everything happens in that one
 * organization on the service path. Callers rate-limit first.
 *
 * Booking: the time is checked again under a per-host advisory lock, in the
 * same transaction that makes the meeting, so two guests racing for one
 * slot can't both get it (the loser is told it was just taken), and a
 * meeting added to the host's calendar after the page loaded blocks it too.
 * A partial unique index on (host, start) backs the lock up.
 *
 * The guest's address isn't trusted until they open the link we email and
 * say it's them (verify): until then the CRM doesn't match them to anyone,
 * stop anyone's follow-ups or open a deal. The meeting itself is on the
 * host's calendar and in their Inbox at once, so nobody misses a real call.
 */

/** Abuse caps (docs/features/booking.md, "Spam and abuse"). */
export const LIMITS = {
  /** Bookings a link takes in any 24 hours. */
  perPagePerDay: 40,
  /**
   * Bookings made on a link in the last 24 hours whose guest hasn't confirmed
   * their address yet: a burst cap only, so old unconfirmed bookings never
   * keep a link shut.
   */
  unverifiedPerPage: 10,
  /** Upcoming bookings one address may hold on one link. */
  perEmailPerPage: 2,
} as const;

/** How far back round-robin counts (and the tie-breaker looks). */
const FAIRNESS_DAYS = 30;

export interface PublicBooking {
  organizationId: string;
  pageId: string;
  orgName: string;
  logoUrl: string | null;
  title: string;
  description: string | null;
  durations: number[];
  tz: string;
  hosts: { id: string; name: string }[];
  /** A personal link: whose. */
  ownerName: string | null;
  questions: BookingQuestion[];
  /** Open starts (ISO) for each length offered. */
  slots: Record<number, string[]>;
  video: boolean;
}

type PageRow = Prisma.CrmBookingPageGetPayload<object>;

/** A link that may take bookings right now, or why not. */
async function openPage(db: TxClient, organizationId: string, pageId: string): Promise<PageRow | null> {
  const page = await db.crmBookingPage.findFirst({ where: { id: pageId, organizationId, active: true } });
  if (!page) return null;
  if (!page.ownerUserId) {
    // Organization links are the CRM's: none once it's off the plan or removed.
    const access = await bookingAccess(db, organizationId);
    if (!access.orgLinks) return null;
  } else {
    const member = await db.membership.findFirst({ where: { organizationId, userId: page.ownerUserId }, select: { userId: true } });
    if (!member) return null;
  }
  return page;
}

export async function loadBooking(slug: string, now: Date = new Date()): Promise<PublicBooking | null> {
  if (!SLUG_RE.test(slug)) return null;
  const target = await publicTarget("booking", slug);
  if (!target) return null;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const page = await openPage(db, target.organizationId, target.id);
    if (!page) return null;
    const org = await db.organization.findUnique({ where: { id: target.organizationId }, select: { name: true, timezone: true, logo: true } });
    const hostIds = await liveHosts(db, page);
    const users = await db.user.findMany({ where: { id: { in: hostIds } }, select: { id: true, name: true } });
    const tz = pageTimeZone(page, org?.timezone ?? "UTC");
    const durations = offeredDurations(page.durationMin, page.durations);
    const slots: Record<number, string[]> = {};
    for (const d of durations) {
      slots[d] = (await slotsFor(db, page, tz, now, { durationMin: d })).map((s) => s.start.toISOString());
    }
    const hosts = hostIds.map((id) => ({ id, name: users.find((u) => u.id === id)?.name ?? "A member" }));
    return {
      organizationId: target.organizationId,
      pageId: page.id,
      orgName: org?.name ?? "",
      logoUrl: orgLogoUrl(org?.logo, 128),
      title: page.title,
      description: page.description,
      durations,
      tz,
      hosts,
      ownerName: page.ownerUserId ? (hosts[0]?.name ?? null) : null,
      questions: readQuestions(page.questions),
      slots,
      video: page.video,
    };
  });
}

export interface BookInput {
  start: string;
  durationMin?: number;
  name: string;
  email: string;
  answers: Record<string, string>;
  timeZone?: string;
}

export type BookResult =
  | { ok: true; when: string; hostName: string; email: string; start?: string; end?: string; title?: string }
  | { ok: false; error: string };

const TAKEN = "That time was just taken. Pick another.";

/** Serializes everything that books a host, across every link and space they're in. */
async function lockHosts(db: TxClient, hostIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(hostIds)].sort()) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-host:${id}`}, 0))`;
  }
}

function systemCtx(db: TxClient, organizationId: string, userId: string, role: Role | null): EventServiceContext {
  return { db, organizationId, userId, role, kind: "system" };
}

/** Where the meeting happens: the connected video account, a standing link, or a place. */
async function meetingPlace(db: TxClient, page: PageRow) {
  const loc = page.location?.trim() || null;
  const isLink = loc ? /^https?:\/\//i.test(loc) : false;
  if (page.video) {
    const provider = await connectedVideo(db, page.organizationId);
    if (provider) return { conferenceProvider: provider, conferenceUrl: null, location: isLink ? null : loc };
    if (isLink) return { conferenceProvider: ConferenceProvider.OTHER, conferenceUrl: loc, location: null };
  } else if (isLink) {
    return { conferenceProvider: ConferenceProvider.OTHER, conferenceUrl: loc, location: null };
  }
  return { conferenceProvider: ConferenceProvider.NONE, conferenceUrl: null, location: loc };
}

/** Round-robin order of the free hosts: fewest bookings on this link lately, then booked longest ago. */
async function fairOrder(db: TxClient, page: PageRow, free: readonly string[], now: Date): Promise<string[]> {
  if (free.length <= 1) return [...free];
  const recent = await db.booking.findMany({
    where: {
      organizationId: page.organizationId,
      pageId: page.id,
      status: "BOOKED",
      createdAt: { gte: new Date(now.getTime() - FAIRNESS_DAYS * 86_400_000) },
    },
    select: { hostUserId: true, createdAt: true },
    take: 5000,
  });
  const load = new Map<string, number>();
  const last = new Map<string, number>();
  for (const r of recent) {
    load.set(r.hostUserId, (load.get(r.hostUserId) ?? 0) + 1);
    last.set(r.hostUserId, Math.max(last.get(r.hostUserId) ?? 0, r.createdAt.getTime()));
  }
  const left = [...free];
  const out: string[] = [];
  while (left.length) {
    const next = pickHost(left, load, last)!;
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function book(slug: string, input: BookInput, now: Date = new Date()): Promise<BookResult> {
  if (!SLUG_RE.test(slug)) return { ok: false, error: "This booking page isn't open." };
  const nameCheck = checkGuestName(input.name);
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error };
  const name = nameCheck.name;
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Add an email address we can confirm to." };
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a time." };
  const guestTz = isValidTimeZone(input.timeZone) ? input.timeZone : null;
  const target = await publicTarget("booking", slug);
  if (!target) return { ok: false, error: "This booking page isn't open." };
  const orgId = target.organizationId;
  try {
    return await withSystemOrgTx(orgId, async ({ db }) => {
      const page = await openPage(db, orgId, target.id);
      if (!page) return { ok: false as const, error: "This booking page isn't open." };
      const durations = offeredDurations(page.durationMin, page.durations);
      const durationMin = input.durationMin ?? page.durationMin;
      if (!durations.includes(durationMin)) return { ok: false as const, error: "Pick how long." };
      const questions = readQuestions(page.questions);
      for (const q of questions) {
        if (q.required && !cleanAnswer(input.answers[q.id])) return { ok: false as const, error: `Answer "${q.label}".` };
      }
      // Abuse caps: a burst on one link, unconfirmed bookings piling up, one address holding many times.
      const dayAgo = new Date(now.getTime() - 86_400_000);
      const [lastDay, unverified, mine] = await Promise.all([
        db.booking.count({ where: { organizationId: orgId, pageId: page.id, createdAt: { gte: dayAgo } } }),
        db.booking.count({ where: { organizationId: orgId, pageId: page.id, status: "BOOKED", verifiedAt: null, startsAt: { gt: now }, createdAt: { gte: dayAgo } } }),
        db.booking.count({ where: { organizationId: orgId, pageId: page.id, status: "BOOKED", guestEmail: email, startsAt: { gt: now } } }),
      ]);
      if (lastDay >= LIMITS.perPagePerDay || unverified >= LIMITS.unverifiedPerPage) {
        return { ok: false as const, error: "This page can't take more bookings right now. Try again tomorrow." };
      }
      if (mine >= LIMITS.perEmailPerPage) {
        return { ok: false as const, error: "You already have a time booked here. Use the link in your email to change it." };
      }
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true, name: true } });
      const tz = pageTimeZone(page, org?.timezone ?? "UTC");
      const first = (await slotsFor(db, page, tz, now, { durationMin })).find((s) => s.start.getTime() === start.getTime());
      if (!first) return { ok: false as const, error: TAKEN };
      // Lock every host free then, then look again: whatever committed meanwhile is seen now.
      await lockHosts(db, first.hostIds);
      const fresh = (await slotsFor(db, page, tz, now, { durationMin })).find((s) => s.start.getTime() === start.getTime());
      if (!fresh) return { ok: false as const, error: TAKEN };
      const [hostId] = await fairOrder(db, page, fresh.hostIds, now);
      if (!hostId) return { ok: false as const, error: TAKEN };
      const host = await db.membership.findFirst({
        where: { organizationId: orgId, userId: hostId },
        select: { role: true, user: { select: { name: true } } },
      });
      if (!host) return { ok: false as const, error: TAKEN };
      const answers = questions
        .map((q) => ({ q: q.label, a: cleanAnswer(input.answers[q.id]) }))
        .filter((x) => x.a);
      // Everyone in the organization can read an event, so the guest's email
      // and answers stay on the Booking (host and admins only); the meeting
      // page shows them from there.
      const description = `Booked through ${page.title}.`;
      const place = await meetingPlace(db, page);
      const { event } = await createEvent(systemCtx(db, orgId, hostId, host.role), {
        title: `${name}: ${page.title}`.slice(0, 200),
        description,
        startsAt: fresh.start,
        endsAt: fresh.end,
        hostUserId: hostId,
        reminderMinutes: page.reminderMinutes ?? undefined,
        ...place,
      });
      await db.eventAttendee.upsert({
        where: { eventId_userId: { eventId: event.id, userId: hostId } },
        create: { organizationId: orgId, eventId: event.id, userId: hostId, rsvp: "YES" },
        update: { rsvp: "YES" },
      });
      const id = newBookingId();
      await db.booking.create({
        data: {
          id,
          organizationId: orgId,
          pageId: page.id,
          eventId: event.id,
          hostUserId: hostId,
          guestName: name,
          guestEmail: email,
          guestTimeZone: guestTz,
          answers: answers as unknown as Prisma.InputJsonArray,
          startsAt: fresh.start,
          endsAt: fresh.end,
          tokenHash: tokenHash(bookingToken(id)),
        },
      });
      const when = whenText(fresh.start, tz);
      await tellHosts(db, orgId, [hostId], {
        title: `${name} booked ${page.title}`,
        body: `${when}, ${durationMin} minutes. ${email}${answers[0] ? `\n${answers[0].q}: ${answers[0].a}` : ""}`,
        eventId: event.id,
        key: `${id}:booked`,
      });
      await emailGuest(db, orgId, id, "booked", { startsAt: fresh.start });
      return {
        ok: true as const,
        when: whenText(fresh.start, guestTz ?? tz),
        hostName: host.user.name ?? "your host",
        email,
        // For "Add to calendar" on the page itself, so the guest has it even if no email reaches them.
        start: fresh.start.toISOString(),
        end: fresh.end.toISOString(),
        title: withHost(page.title, host.user.name ?? "your host"),
      };
    });
  } catch (error) {
    // The unique (host, start) index: someone else got there in the same instant.
    if (isUniqueViolation(error)) return { ok: false, error: TAKEN };
    throw error;
  }
}

// ---- The guest's own link ------------------------------------------------------------

export interface GuestView {
  bookingId: string;
  title: string;
  orgName: string;
  hostName: string;
  startsAt: Date;
  endsAt: Date;
  tz: string;
  guestTz: string | null;
  durationMin: number;
  status: "BOOKED" | "CANCELLED";
  past: boolean;
  verified: boolean;
  joinUrl: string | null;
  location: string | null;
  slug: string;
  /** New times with the same host, for Pick another time. */
  slots: string[];
}

async function findByToken(token: string) {
  if (!BOOKING_TOKEN_RE.test(token)) return null;
  return publicTarget("booking-guest", tokenHash(token));
}

export async function guestView(token: string, now: Date = new Date(), withSlots = false): Promise<GuestView | null> {
  const target = await findByToken(token);
  if (!target) return null;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const b = await db.booking.findFirst({ where: { id: target.id, organizationId: target.organizationId }, include: { page: true } });
    if (!b) return null;
    const [org, host, event] = await Promise.all([
      db.organization.findUnique({ where: { id: b.organizationId }, select: { name: true, timezone: true } }),
      db.user.findUnique({ where: { id: b.hostUserId }, select: { name: true } }),
      db.event.findFirst({ where: { id: b.eventId, organizationId: b.organizationId }, select: { conferenceUrl: true, location: true } }),
    ]);
    const tz = pageTimeZone(b.page, org?.timezone ?? "UTC");
    const durationMin = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
    const open = b.status === "BOOKED" && b.startsAt > now && b.page.active;
    const slots =
      withSlots && open
        ? (
            await slotsFor(db, b.page, tz, now, {
              durationMin,
              exceptEventId: b.eventId,
              exceptBookingId: b.id,
              onlyHost: b.hostUserId,
            })
          )
            // Its own time is where it already is, not another one.
            .filter((s) => s.start.getTime() !== b.startsAt.getTime())
            .map((s) => s.start.toISOString())
        : [];
    return {
      bookingId: b.id,
      title: b.page.title,
      orgName: org?.name ?? "",
      hostName: host?.name ?? "your host",
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      tz,
      guestTz: b.guestTimeZone,
      durationMin,
      status: b.status,
      past: b.startsAt <= now,
      verified: Boolean(b.verifiedAt),
      joinUrl: b.status === "BOOKED" ? (event?.conferenceUrl ?? null) : null,
      location: event?.location ?? null,
      slug: b.page.slug,
      slots,
    };
  });
}

/**
 * The CRM side, once the guest has said the address is theirs: find them
 * by address (else add them, owned by the host), put the meeting on their
 * timeline, open the link's pipeline item, stop sequences that stop on a
 * booking and mark campaigns booked, then tell automations.
 */
async function intoCrm(db: TxClient, booking: { id: string; organizationId: string; hostUserId: string; guestName: string; guestEmail: string; eventId: string; startsAt: Date; answers: unknown }, page: PageRow): Promise<string | null> {
  const orgId = booking.organizationId;
  const host = await db.membership.findFirst({ where: { organizationId: orgId, userId: booking.hostUserId }, select: { role: true } });
  if (!host) return null;
  const actor: CrmActor = { db, organizationId: orgId, userId: booking.hostUserId, role: host.role };
  const existing = await db.crmPersonEmail.findFirst({
    where: { organizationId: orgId, email: booking.guestEmail, person: { deletedAt: null } },
    select: { personId: true },
  });
  let personId = existing?.personId ?? null;
  if (!personId) {
    const parts = splitName(booking.guestName);
    personId = (
      await createPerson(
        actor,
        { name: booking.guestName, firstName: parts.firstName, lastName: parts.lastName, primaryEmail: booking.guestEmail, source: "booking", sourceDetail: page.title, ownerId: booking.hostUserId },
        { trusted: true, source: "system" },
      )
    ).id;
  }
  const person = await db.crmPerson.findFirst({ where: { id: personId, organizationId: orgId }, select: { companyId: true } });
  let dealId: string | null = null;
  if (page.pipelineId && !page.ownerUserId) {
    dealId = (
      await createDeal(
        actor,
        { pipelineId: page.pipelineId, title: `${booking.guestName}: ${page.title}`, primaryPersonId: personId, companyId: person?.companyId ?? null, ownerId: booking.hostUserId, source: "booking", nextStep: page.title, nextStepAt: booking.startsAt },
        { trusted: true, source: "system" },
      ).catch(() => ({ id: null as string | null }))
    ).id;
  }
  const answers = Array.isArray(booking.answers) ? (booking.answers as { q: string; a: string }[]) : [];
  await logActivity(db, {
    organizationId: orgId,
    kind: "MEETING",
    subject: `${page.title} with ${booking.guestName}`,
    body: answers.map((x) => `${x.q}: ${x.a}`).join("\n") || null,
    occurredAt: booking.startsAt,
    targets: [
      { kind: "person", id: personId },
      ...(person?.companyId ? [{ kind: "company" as const, id: person.companyId }] : []),
      ...(dealId ? [{ kind: "deal" as const, id: dealId }] : []),
    ],
    actorId: booking.hostUserId,
    sourceKind: "event",
    sourceId: booking.eventId,
    meta: { bookingPageId: page.id, bookingId: booking.id, eventKind: "OTHER", booked: true },
  });
  await stopEnrollments(db, orgId, personId, "BOOKED", "they booked a meeting");
  await advanceTargets(db, orgId, personId, "BOOKED");
  await emitCrmEvent(db, orgId, { type: "meeting.booked", targetKind: "person", targetId: personId, sourceId: booking.eventId, source: "system" });
  return personId;
}

/** "Yes, this is me": the guest confirms the address. Idempotent. */
export async function verifyBooking(token: string): Promise<boolean> {
  const target = await findByToken(token);
  if (!target) return false;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    // The first confirmation wins; a second (a double click, a scanner) changes nothing.
    const claimed = await db.booking.updateMany({
      where: { id: target.id, organizationId: target.organizationId, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    if (claimed.count === 0) return true;
    const b = await db.booking.findFirst({ where: { id: target.id, organizationId: target.organizationId }, include: { page: true } });
    if (!b) return false;
    if (b.status === "BOOKED" && (await bookingAccess(db, b.organizationId)).crm) {
      const personId = await intoCrm(db, b, b.page);
      if (personId) await db.booking.update({ where: { id: b.id }, data: { personId } });
    }
    return true;
  });
}

export type GuestChange = { ok: true; when?: string } | { ok: false; error: string };

/** The guest cancels: the meeting comes off the host's calendar, the host is told, the guest gets a receipt. */
export async function guestCancel(token: string, reason: string, now: Date = new Date()): Promise<GuestChange> {
  const target = await findByToken(token);
  if (!target) return { ok: false, error: "This link isn't valid any more." };
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const b = await db.booking.findFirst({ where: { id: target.id, organizationId: target.organizationId }, include: { page: true } });
    if (!b || b.status !== "BOOKED") return { ok: true as const };
    if (b.startsAt <= now) return { ok: false as const, error: "This meeting has already started." };
    await cancelBooking(db, b, "guest", reason, null);
    return { ok: true as const };
  });
}

/** Shared by the guest, the host and the jobs: mark it cancelled, take the meeting off, tell whoever didn't do it. */
export async function cancelBooking(
  db: TxClient,
  b: { id: string; organizationId: string; eventId: string; hostUserId: string; guestName: string; startsAt: Date; personId: string | null; page: { title: string } },
  by: "guest" | "host" | "system",
  reason: string,
  actorId: string | null,
): Promise<void> {
  const done = await db.booking.updateMany({
    where: { id: b.id, organizationId: b.organizationId, status: "BOOKED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason.trim().slice(0, 500) || null },
  });
  if (done.count === 0) return;
  const live = await db.event.findFirst({ where: { id: b.eventId, organizationId: b.organizationId, deletedAt: null }, select: { id: true } });
  if (live) await deleteEvent(systemCtx(db, b.organizationId, b.hostUserId, null), b.eventId);
  const org = await db.organization.findUnique({ where: { id: b.organizationId }, select: { timezone: true } });
  const when = whenText(b.startsAt, org?.timezone ?? "UTC");
  await tellHosts(db, b.organizationId, [b.hostUserId], {
    title: by === "guest" ? `${b.guestName} cancelled ${b.page.title}` : `${b.page.title} with ${b.guestName} was cancelled`,
    body: `${when}${reason.trim() ? `\n"${reason.trim().slice(0, 300)}"` : ""}`,
    eventId: null,
    key: `${b.id}:cancelled`,
    actorId,
  });
  await emailGuest(db, b.organizationId, b.id, "cancelled", { startsAt: b.startsAt });
  if (b.personId) {
    await logActivity(db, {
      organizationId: b.organizationId,
      kind: "SYSTEM",
      subject: `${b.page.title} cancelled (${by === "guest" ? "by them" : "by us"})`,
      targets: [{ kind: "person", id: b.personId }],
      sourceKind: "booking-cancelled",
      sourceId: b.id,
    }).catch(() => undefined);
  }
}

/** The guest picks another time with the same host. */
export async function guestReschedule(token: string, startIso: string, now: Date = new Date()): Promise<GuestChange> {
  const target = await findByToken(token);
  if (!target) return { ok: false, error: "This link isn't valid any more." };
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a time." };
  try {
    return await withSystemOrgTx(target.organizationId, async ({ db }) => {
      const b = await db.booking.findFirst({ where: { id: target.id, organizationId: target.organizationId }, include: { page: true } });
      if (!b || b.status !== "BOOKED") return { ok: false as const, error: "This booking was cancelled. Book a new time instead." };
      if (b.startsAt <= now) return { ok: false as const, error: "This meeting has already started." };
      if (!b.page.active) return { ok: false as const, error: "This link isn't taking changes. Reply to your confirmation instead." };
      const org = await db.organization.findUnique({ where: { id: b.organizationId }, select: { timezone: true } });
      const tz = pageTimeZone(b.page, org?.timezone ?? "UTC");
      const durationMin = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
      const opts = { durationMin, exceptEventId: b.eventId, exceptBookingId: b.id, onlyHost: b.hostUserId };
      await lockHosts(db, [b.hostUserId]);
      const slot = (await slotsFor(db, b.page, tz, now, opts)).find((s) => s.start.getTime() === start.getTime());
      if (!slot) return { ok: false as const, error: TAKEN };
      await moveBooking(db, b, slot.start, slot.end, "guest", null);
      return { ok: true as const, when: whenText(slot.start, b.guestTimeZone ?? tz) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: TAKEN };
    throw error;
  }
}

/** Move a booking (and its meeting) and tell whoever didn't move it. */
export async function moveBooking(
  db: TxClient,
  b: { id: string; organizationId: string; eventId: string; hostUserId: string; guestName: string; startsAt: Date; page: { title: string } },
  start: Date,
  end: Date,
  by: "guest" | "host",
  actorId: string | null,
  moveEvent = true,
): Promise<void> {
  await db.booking.update({ where: { id: b.id }, data: { startsAt: start, endsAt: end, remindedOffsets: [] } });
  if (moveEvent) {
    await updateEvent(systemCtx(db, b.organizationId, b.hostUserId, null), b.eventId, { startsAt: start, endsAt: end });
  }
  const org = await db.organization.findUnique({ where: { id: b.organizationId }, select: { timezone: true } });
  const tz = org?.timezone ?? "UTC";
  await tellHosts(db, b.organizationId, [b.hostUserId], {
    title: by === "guest" ? `${b.guestName} moved ${b.page.title}` : `${b.page.title} with ${b.guestName} moved`,
    body: `Now ${whenText(start, tz)} (was ${whenText(b.startsAt, tz)})`,
    eventId: b.eventId,
    key: `${b.id}:moved:${start.getTime()}`,
    actorId,
  });
  await emailGuest(db, b.organizationId, b.id, "moved", { startsAt: start });
}
