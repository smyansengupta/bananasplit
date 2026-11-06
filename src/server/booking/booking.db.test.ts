// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The booking audit against the real roles and policies on the local
 * database (docs/features/booking.md, "Audit"): a personal link with no
 * CRM, double booking (two guests racing, a meeting added after the page
 * loaded, in another space), cancel and reschedule by the guest and by the
 * host, a host who leaves, reminders sent once, email failing, the abuse
 * caps, and the CRM side waiting for the guest to confirm their address.
 * Skipped when the database is not reachable.
 */

process.env.EMAIL_DELIVERY = "sink";

const { requireUserMock, sendMock } = vi.hoisted(() => ({ requireUserMock: vi.fn(), sendMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));
vi.mock("@/server/email/mailer", async (orig) => {
  const real = await orig<typeof import("@/server/email/mailer")>();
  const mailer = { kind: "platform" as const, from: "Bananasplit <no-reply@example.org>", label: "test", send: sendMock };
  return {
    ...real,
    getPlatformMailer: () => mailer,
    getOrgMailer: async () => mailer,
    resolveOrgMailRouting: async () => ({ mode: "platform-fallback" as const, orgName: "x" }),
  };
});

import { untieDepartingMember } from "@/server/settings/members";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { deleteEvent, updateEvent } from "@/server/events/service";
import { runSetup } from "@/server/crm/setup";
import { createPerson } from "@/server/crm/people";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { book, guestCancel, guestReschedule, guestView, LIMITS, loadBooking, verifyBooking } from "./book";
import { bookingEmailJob } from "./jobs";
import { mainLinkId } from "./access";
import { createOrgLink, ensureMainLink, ensurePersonalLink, updateLink } from "./links";
import { bookingHostLeft, hostCancel, queueGuestReminders, syncBookingToEvent, takeBooking } from "./manage";
import { bookingToken } from "./token";

const tag = randomBytes(4).toString("hex");
const plain = `c_book_${tag}`;
const crmOrg = `c_bookcrm_${tag}`;
const personalOrg = `c_bookme_${tag}`;
const ALL_DAY = { "1": [[0, 1440]], "2": [[0, 1440]], "3": [[0, 1440]], "4": [[0, 1440]], "5": [[0, 1440]], "6": [[0, 1440]], "7": [[0, 1440]] } as const;

type U = { id: string; email: string; name: string };
let owner: U;
let host: U;
let other: U;
let reachable = true;

async function makeUser(local: string): Promise<U> {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name: local, emailVerified: new Date(), onboardedAt: new Date(), timezone: "UTC" },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

function as<T>(user: U, org: string, fn: (ctx: OrgContext) => Promise<T>): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org, fn);
}

function run<P>(org: string, payload: P) {
  return {
    id: "j",
    kind: "k",
    organizationId: org,
    payload,
    dedupeKey: "k",
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 60_000,
  };
}

/** A link open around the clock, every day, from now, so tests have times. */
async function openLink(user: U, org: string) {
  const link = await as(user, org, (ctx) => ensurePersonalLink(ctx));
  await as(user, org, (ctx) =>
    updateLink(ctx, link.id, { hours: ALL_DAY as never, minNoticeHours: 0, maxDaysAhead: 7, durationMin: 30, bufferMin: 0, timezone: "UTC", active: true }),
  );
  return link;
}

async function slotsOf(slug: string, i = 0, d = 30): Promise<string> {
  const loaded = await loadBooking(slug);
  const s = loaded?.slots[d]?.[i];
  if (!s) throw new Error("no slots");
  return s;
}

const guest = (n: string) => ({ name: `Guest ${n}`, email: `g-${n}-${tag}@example.org`, answers: {} });

async function jobs(org: string, kind: string) {
  return ownerDb.job.findMany({ where: { organizationId: org, kind }, orderBy: { createdAt: "asc" } });
}

beforeAll(async () => {
  try {
    owner = await makeUser("book-owner");
    host = await makeUser("book-host");
    other = await makeUser("book-other");
    await ownerDb.organization.createMany({
      data: [
        { id: plain, name: "Booking Test", slug: `booking-${tag}`, timezone: "UTC", plan: "SOCIETY" },
        { id: crmOrg, name: "Booking CRM", slug: `bookingcrm-${tag}`, timezone: "UTC", plan: "SOCIETY" },
        { id: personalOrg, name: "Host's space", slug: `bookme-${tag}`, timezone: "UTC", kind: "PERSONAL", plan: "FREE", personalOwnerId: host.id },
      ],
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: plain, userId: owner.id, role: "OWNER" },
        { organizationId: plain, userId: host.id, role: "MEMBER" },
        { organizationId: plain, userId: other.id, role: "MEMBER" },
        { organizationId: crmOrg, userId: owner.id, role: "OWNER" },
        { organizationId: crmOrg, userId: host.id, role: "MEMBER" },
        { organizationId: crmOrg, userId: other.id, role: "MEMBER" },
        { organizationId: personalOrg, userId: host.id, role: "OWNER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: crmOrg },
      create: { organizationId: crmOrg, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
    await as(owner, crmOrg, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[booking.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "sent" });
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [plain, crmOrg, personalOrg] } } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, host, other].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("meeting links against the local database", () => {
  it("gives every member a personal link without the CRM, and a booking lands on the calendar and in the Inbox", async () => {
    if (!reachable) return;
    // A new personal link is off until its owner turns it on.
    const fresh = await as(host, plain, (ctx) => ensurePersonalLink(ctx));
    expect((await ownerDb.crmBookingPage.findUniqueOrThrow({ where: { id: fresh.id } })).active).toBe(false);
    expect(await loadBooking(fresh.slug)).toBeNull();
    const link = await openLink(host, plain);
    // Only its owner changes it.
    await expect(as(other, plain, (ctx) => updateLink(ctx, link.id, { title: "Mine now" }))).rejects.toThrow();
    // Organization links need the CRM.
    await expect(as(owner, plain, (ctx) => createOrgLink(ctx, "Coffee"))).rejects.toThrow(/CRM/);

    const start = await slotsOf(link.slug);
    const r = await book(link.slug, { start, ...guest("one"), answers: { q1: "The budget" }, timeZone: "Asia/Tokyo" });
    expect(r.ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-one-${tag}@example.org` } });
    expect(b.guestTimeZone).toBe("Asia/Tokyo");
    const event = await ownerDb.event.findUniqueOrThrow({ where: { id: b.eventId } });
    expect([event.hostUserId, event.startsAt.toISOString(), event.deletedAt]).toEqual([host.id, start, null]);
    // Every member reads events: the guest's email and answers stay on the Booking.
    expect(event.description).not.toContain("The budget");
    expect(event.description).not.toContain("@example.org");
    expect(b.answers).toEqual([{ q: "What would you like to talk about?", a: "The budget" }]);
    expect(event.reminderMinutes).toEqual([1440, 60]);
    const attendee = await ownerDb.eventAttendee.findFirstOrThrow({ where: { eventId: b.eventId, userId: host.id } });
    expect(attendee.rsvp).toBe("YES");
    const note = await ownerDb.notification.findFirstOrThrow({ where: { organizationId: plain, userId: host.id, type: "MEETING_BOOKED" } });
    expect(note.title).toContain("Guest one booked");
    expect((await jobs(plain, "booking-email")).some((j) => (j.payload as { bookingId: string }).bookingId === b.id)).toBe(true);
    // No CRM here: nobody was added anywhere.
    expect(await ownerDb.crmPerson.count({ where: { organizationId: plain } })).toBe(0);

    // The guest's link shows it; a scanner opening it changes nothing.
    const view = await guestView(bookingToken(b.id));
    expect([view?.status, view?.verified]).toEqual(["BOOKED", false]);
  });

  it("lets only one of two guests racing for the same time have it", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 5);
    const results = await Promise.all([
      book(link.slug, { start, ...guest("race-a") }),
      book(link.slug, { start, ...guest("race-b") }),
      book(link.slug, { start, ...guest("race-c") }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.error))).toEqual([
      "That time was just taken. Pick another.",
      "That time was just taken. Pick another.",
    ]);
    expect(await ownerDb.booking.count({ where: { organizationId: plain, startsAt: new Date(start), status: "BOOKED" } })).toBe(1);
  });

  it("tells the guest the time was taken when only the unique index stops the second booking", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 120);
    const at = new Date(start);
    const end = new Date(at.getTime() + 30 * 60_000);
    // A live booking whose meeting is gone, so the slot check can't see it and only the index can.
    const gone = await ownerDb.event.create({
      data: { organizationId: plain, title: "Gone", startsAt: at, endsAt: end, createdById: host.id, deletedAt: new Date() },
    });
    await ownerDb.booking.create({
      data: {
        id: `stale-${tag}`,
        organizationId: plain,
        pageId: link.id,
        eventId: gone.id,
        hostUserId: host.id,
        guestName: "Stale",
        guestEmail: `stale-${tag}@example.org`,
        startsAt: at,
        endsAt: end,
        tokenHash: `stale-${tag}`,
      },
    });
    expect(await book(link.slug, { start, ...guest("indexed") })).toEqual({ ok: false, error: "That time was just taken. Pick another." });
    // A guest moving onto it hears the same.
    const other2 = await slotsOf(link.slug, 124);
    expect((await book(link.slug, { start: other2, ...guest("indexed-move") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-indexed-move-${tag}@example.org` } });
    expect(await guestReschedule(bookingToken(b.id), start)).toEqual({ ok: false, error: "That time was just taken. Pick another." });
    await ownerDb.booking.delete({ where: { id: `stale-${tag}` } });
  });

  it("refuses a time that a meeting added after the page loaded now covers, even one in another space", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 9);
    // The host adds something to their Personal calendar after the guest opened the page.
    await ownerDb.event.create({
      data: {
        organizationId: personalOrg,
        title: "Dentist",
        startsAt: new Date(new Date(start).getTime() - 10 * 60_000),
        endsAt: new Date(new Date(start).getTime() + 10 * 60_000),
        createdById: host.id,
      },
    });
    const r = await book(link.slug, { start, ...guest("late") });
    expect(r).toEqual({ ok: false, error: "That time was just taken. Pick another." });
    expect((await loadBooking(link.slug))!.slots[30]).not.toContain(start);
  });

  it("holds minimum notice and the buffer when booking directly", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    await as(host, plain, (ctx) => updateLink(ctx, link.id, { minNoticeHours: 48 }));
    const soon = new Date(Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000).toISOString();
    expect((await book(link.slug, { start: soon, ...guest("soon") })).ok).toBe(false);
    const later = await slotsOf(link.slug, 0);
    expect(new Date(later).getTime()).toBeGreaterThanOrEqual(Date.now() + 48 * 3_600_000 - 60_000);
    await as(host, plain, (ctx) => updateLink(ctx, link.id, { minNoticeHours: 0, bufferMin: 30 }));
    const first = await slotsOf(link.slug, 20);
    expect((await book(link.slug, { start: first, ...guest("buffer-a") })).ok).toBe(true);
    // Right after it, with no gap: refused.
    const right = new Date(new Date(first).getTime() + 30 * 60_000).toISOString();
    expect((await book(link.slug, { start: right, ...guest("buffer-b") })).ok).toBe(false);
    await as(host, plain, (ctx) => updateLink(ctx, link.id, { bufferMin: 0 }));
  });

  it("refuses links in the name, and caps one address and one link", async () => {
    if (!reachable) return;
    const link = await openLink(other, plain);
    const start = await slotsOf(link.slug, 1);
    expect(await book(link.slug, { start, name: "https://evil.example/login", email: `x-${tag}@example.org`, answers: {} })).toMatchObject({ ok: false });
    for (let i = 0; i < LIMITS.perEmailPerPage; i++) {
      expect((await book(link.slug, { start: await slotsOf(link.slug, i * 3), ...guest("repeat") })).ok).toBe(true);
    }
    const third = await book(link.slug, { start: await slotsOf(link.slug, 12), ...guest("repeat") });
    expect(third).toMatchObject({ ok: false, error: expect.stringMatching(/already have a time/) });
  });

  it("lets the guest move and cancel: the meeting follows, the host is told, the guest gets a receipt", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 30);
    expect((await book(link.slug, { start, ...guest("mover") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-mover-${tag}@example.org` } });
    const token = bookingToken(b.id);
    const view = await guestView(token, new Date(), true);
    const next = view!.slots.find((s) => s !== start)!;
    // Its own time isn't offered as another one.
    expect(view!.slots).not.toContain(start);
    expect(await guestReschedule(token, next)).toMatchObject({ ok: true });
    const moved = await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } });
    const event = await ownerDb.event.findUniqueOrThrow({ where: { id: b.eventId } });
    expect([moved.startsAt.toISOString(), event.startsAt.toISOString()]).toEqual([next, next]);
    expect(await ownerDb.notification.count({ where: { userId: host.id, title: { contains: "Guest mover moved" } } })).toBe(1);
    // The old time is free again.
    expect((await loadBooking(link.slug))!.slots[30]).toContain(start);
    // The sync job the move queued finds nothing to do (no second email).
    await syncBookingToEvent(plain, b.eventId);
    expect((await jobs(plain, "booking-email")).filter((j) => j.dedupeKey.startsWith(`booking-email:${b.id}:moved`))).toHaveLength(1);

    expect(await guestCancel(token, "Something came up")).toEqual({ ok: true });
    const gone = await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([gone.status, gone.cancelledBy, gone.cancelReason]).toEqual(["CANCELLED", "guest", "Something came up"]);
    expect((await ownerDb.event.findUniqueOrThrow({ where: { id: b.eventId } })).deletedAt).not.toBeNull();
    expect(await ownerDb.notification.count({ where: { userId: host.id, title: { contains: "Guest mover cancelled" } } })).toBe(1);
    // The cancellation receipt goes; a "moved" email still queued for it finds nothing true and sends nothing.
    sendMock.mockClear();
    await bookingEmailJob(run(plain, { bookingId: b.id, template: "moved", startsAt: next }));
    expect(sendMock).not.toHaveBeenCalled();
    await bookingEmailJob(run(plain, { bookingId: b.id, template: "cancelled", startsAt: next }));
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("follows the host moving or deleting the meeting on the calendar, and tells the guest", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 40);
    expect((await book(link.slug, { start, ...guest("hostmove") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-hostmove-${tag}@example.org` } });
    const later = new Date(new Date(start).getTime() + 3 * 3_600_000);
    // An admin drags it on the calendar.
    await as(owner, plain, (ctx) => updateEvent(ctx, b.eventId, { startsAt: later, endsAt: new Date(later.getTime() + 30 * 60_000) }));
    expect((await jobs(plain, "booking-sync")).some((j) => (j.payload as { eventId: string }).eventId === b.eventId)).toBe(true);
    await syncBookingToEvent(plain, b.eventId);
    expect((await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } })).startsAt.toISOString()).toBe(later.toISOString());
    expect((await jobs(plain, "booking-email")).some((j) => j.dedupeKey === `booking-email:${b.id}:moved:${Math.floor(later.getTime() / 60_000)}`)).toBe(true);
    // The host is told an admin moved their meeting.
    expect(await ownerDb.notification.count({ where: { userId: host.id, title: { contains: "moved" }, body: { contains: "Now" } } })).toBeGreaterThan(0);
    // Then deletes it.
    await as(owner, plain, (ctx) => deleteEvent(ctx, b.eventId));
    await syncBookingToEvent(plain, b.eventId);
    const gone = await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([gone.status, gone.cancelledBy]).toEqual(["CANCELLED", "host"]);
  });

  it("tells the host every time a guest moves, even back to a time they had before", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const [a, b2] = [await slotsOf(link.slug, 80), await slotsOf(link.slug, 84)];
    expect((await book(link.slug, { start: a, ...guest("backagain") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-backagain-${tag}@example.org` } });
    const token = bookingToken(b.id);
    for (const to of [b2, a, b2]) expect((await guestReschedule(token, to)).ok).toBe(true);
    expect(await ownerDb.notification.count({ where: { userId: host.id, title: { contains: "Guest backagain moved" } } })).toBe(3);
    expect((await ownerDb.event.findUniqueOrThrow({ where: { id: b.eventId } })).startsAt.toISOString()).toBe(b2);
  });

  it("holds the most a day, and a time already booked, when booking directly", async () => {
    if (!reachable) return;
    const link = await openLink(other, plain);
    const start = await slotsOf(link.slug, 100);
    expect((await book(link.slug, { start, ...guest("taken-a") })).ok).toBe(true);
    expect(await book(link.slug, { start, ...guest("taken-b") })).toEqual({ ok: false, error: "That time was just taken. Pick another." });
    expect((await loadBooking(link.slug))!.slots[30]).not.toContain(start);
    // One a day: the rest of that day closes.
    await as(other, plain, (ctx) => updateLink(ctx, link.id, { maxPerDay: 1 }));
    const day = start.slice(0, 10);
    expect((await loadBooking(link.slug))!.slots[30]!.filter((s) => s.startsWith(day))).toEqual([]);
    await as(other, plain, (ctx) => updateLink(ctx, link.id, { maxPerDay: null }));
  });

  it("lets the host cancel from Meeting links, and members read only their own bookings", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 50);
    expect((await book(link.slug, { start, ...guest("hostcancel") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-hostcancel-${tag}@example.org` } });
    // Another member can't see it (RLS), so can't cancel it.
    expect(await as(other, plain, (ctx) => ctx.db.booking.count({ where: { id: b.id } }))).toBe(0);
    await expect(as(other, plain, (ctx) => hostCancel(ctx, b.id, ""))).rejects.toThrow(/isn't here/);
    expect(await as(owner, plain, (ctx) => ctx.db.booking.count({ where: { id: b.id } }))).toBe(1);
    await as(host, plain, (ctx) => hostCancel(ctx, b.id, "Sorry, I'm out"));
    const gone = await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([gone.status, gone.cancelledBy]).toEqual(["CANCELLED", "host"]);
    expect((await ownerDb.event.findUniqueOrThrow({ where: { id: b.eventId } })).deletedAt).not.toBeNull();
  });

  it("sends each reminder once, releases it when sending fails, and the host still has the Inbox line and the meeting", async () => {
    if (!reachable) return;
    const link = await openLink(host, plain);
    const start = await slotsOf(link.slug, 60);
    expect((await book(link.slug, { start, ...guest("remind") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-remind-${tag}@example.org` } });
    // The meeting's reminder fan-out queues the guest's (members get theirs in-app as before).
    expect(await withSystemOrgTx(plain, ({ db }) => queueGuestReminders(db, plain, b.eventId, 60, new Date(start)))).toBe(1);
    // Sending fails: the job throws (and retries); nothing is marked sent.
    sendMock.mockRejectedValueOnce(new Error("provider down"));
    await expect(bookingEmailJob(run(plain, { bookingId: b.id, template: "reminder", offsetMinutes: 60, startsAt: start }))).rejects.toThrow();
    expect((await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } })).remindedOffsets).toEqual([]);
    expect(await ownerDb.notification.count({ where: { userId: host.id, title: { contains: "Guest remind booked" } } })).toBe(1);
    expect((await ownerDb.event.findUniqueOrThrow({ where: { id: b.eventId } })).deletedAt).toBeNull();
    // The retry sends it; a second run (a lost lease, a second fan-out) doesn't.
    await bookingEmailJob(run(plain, { bookingId: b.id, template: "reminder", offsetMinutes: 60, startsAt: start }));
    await bookingEmailJob(run(plain, { bookingId: b.id, template: "reminder", offsetMinutes: 60, startsAt: start }));
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect((await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } })).remindedOffsets).toEqual([60]);
    expect(await withSystemOrgTx(plain, ({ db }) => queueGuestReminders(db, plain, b.eventId, 60, new Date(start)))).toBe(0);
    // The confirmation is from Bananasplit itself, never "from" the host, and asks them to confirm.
    sendMock.mockClear();
    await bookingEmailJob(run(plain, { bookingId: b.id, template: "booked", startsAt: start }));
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ to: `g-remind-${tag}@example.org`, subject: expect.stringMatching(/^Confirm your time/) });
  });

  it("lets only admins and CRM managers put someone else on an organization link", async () => {
    if (!reachable) return;
    const link = await as(other, crmOrg, (ctx) => createOrgLink(ctx, "Pick my brain"));
    // A member can't publish another member's open times or book their calendar.
    await expect(as(other, crmOrg, (ctx) => updateLink(ctx, link.id, { hostIds: [owner.id] }))).rejects.toThrow(/admins and CRM managers/);
    await expect(as(other, crmOrg, (ctx) => updateLink(ctx, link.id, { hostIds: [other.id, host.id] }))).rejects.toThrow(/admins and CRM managers/);
    // Themselves, yes; and an admin may add anyone.
    await as(other, crmOrg, (ctx) => updateLink(ctx, link.id, { hostIds: [other.id], title: "Still mine" }));
    await as(owner, crmOrg, (ctx) => updateLink(ctx, link.id, { hostIds: [other.id, host.id] }));
    expect((await ownerDb.crmBookingPage.findUniqueOrThrow({ where: { id: link.id } })).hostIds).toEqual([other.id, host.id]);
    // Once on it, a host may keep the others on it (nobody new added).
    await as(other, crmOrg, (ctx) => updateLink(ctx, link.id, { hostIds: [host.id, other.id] }));
  });

  it("waits for the guest to confirm before the CRM matches them, then puts the meeting on their timeline", async () => {
    if (!reachable) return;
    const existing = await as(owner, crmOrg, (ctx) => createPerson(ctx, { name: "Real Contact", primaryEmail: `real-${tag}@example.org` }));
    const link = await as(owner, crmOrg, (ctx) => createOrgLink(ctx, "Coffee with the president"));
    await as(owner, crmOrg, (ctx) =>
      updateLink(ctx, link.id, { hours: ALL_DAY as never, timezone: "UTC", minNoticeHours: 0, maxDaysAhead: 7, hostIds: [owner.id, host.id] }),
    );
    const start = await slotsOf(link.slug, 2);
    // Someone books with a real contact's address.
    expect((await book(link.slug, { start, name: "Not Really", email: `real-${tag}@example.org`, answers: {} })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: crmOrg, guestEmail: `real-${tag}@example.org` } });
    const onTimeline = () =>
      ownerDb.crmActivity.count({ where: { organizationId: crmOrg, kind: "MEETING", targets: { some: { targetId: existing.id } } } });
    expect(await onTimeline()).toBe(0);
    expect(b.personId).toBeNull();
    // They confirm (twice: a double click changes nothing more).
    expect(await verifyBooking(bookingToken(b.id))).toBe(true);
    expect(await verifyBooking(bookingToken(b.id))).toBe(true);
    expect(await onTimeline()).toBe(1);
    expect((await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } })).personId).toBe(existing.id);
    expect(await verifyBooking("x".repeat(32))).toBe(false);

    // The guest moves it: the timeline's meeting moves with it; then they cancel: it goes.
    const later = await slotsOf(link.slug, 9);
    expect((await guestReschedule(bookingToken(b.id), later)).ok).toBe(true);
    const meeting = () =>
      ownerDb.crmActivity.findFirst({ where: { organizationId: crmOrg, kind: "MEETING", sourceKind: "event", sourceId: b.eventId } });
    expect((await meeting())?.occurredAt.toISOString()).toBe(later);
    expect((await guestCancel(bookingToken(b.id), "")).ok).toBe(true);
    expect((await meeting())?.deletedAt).not.toBeNull();
  });

  it("moves a leaving host's bookings to another host, flags what nobody can take, and stops their own link", async () => {
    if (!reachable) return;
    const link = await as(owner, crmOrg, (ctx) => createOrgLink(ctx, "Office hours"));
    await as(owner, crmOrg, (ctx) =>
      updateLink(ctx, link.id, { hours: ALL_DAY as never, timezone: "UTC", minNoticeHours: 0, maxDaysAhead: 7, hostIds: [other.id, owner.id] }),
    );
    const own = await openLink(other, crmOrg);
    // Fill the owner's calendar at one time so round-robin gives it to "other".
    const start = await slotsOf(link.slug, 70);
    expect((await book(link.slug, { start, ...guest("leave-a") })).ok).toBe(true);
    const shared = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: crmOrg, guestEmail: `g-leave-a-${tag}@example.org` } });
    const personalStart = await slotsOf(own.slug, 75);
    expect((await book(own.slug, { start: personalStart, ...guest("leave-b") })).ok).toBe(true);
    const personal = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: crmOrg, guestEmail: `g-leave-b-${tag}@example.org` } });
    // Make sure the shared one is the leaver's.
    if (shared.hostUserId !== other.id) await ownerDb.booking.update({ where: { id: shared.id }, data: { hostUserId: other.id } });

    await as(owner, crmOrg, async (ctx) => {
      await untieDepartingMember(ctx.db, crmOrg, other.id);
      await ctx.db.membership.delete({ where: { userId_organizationId: { userId: other.id, organizationId: crmOrg } } });
    });
    expect((await jobs(crmOrg, "booking-host-left")).length).toBeGreaterThan(0);
    // Their own link stops at once; the shared one loses them.
    expect(await loadBooking(own.slug)).toBeNull();
    expect((await ownerDb.crmBookingPage.findUniqueOrThrow({ where: { id: link.id } })).hostIds).toEqual([owner.id]);

    await bookingHostLeft(crmOrg, other.id);
    const handed = await ownerDb.booking.findUniqueOrThrow({ where: { id: shared.id } });
    expect([handed.hostUserId, handed.needsHost]).toEqual([owner.id, false]);
    expect((await ownerDb.event.findUniqueOrThrow({ where: { id: shared.eventId } })).hostUserId).toBe(owner.id);
    const flagged = await ownerDb.booking.findUniqueOrThrow({ where: { id: personal.id } });
    expect(flagged.needsHost).toBe(true);
    expect(await ownerDb.notification.count({ where: { organizationId: crmOrg, userId: owner.id, title: { contains: "needs a host" } } })).toBe(1);
    // An admin takes it.
    await as(owner, crmOrg, (ctx) => takeBooking(ctx, personal.id));
    const taken = await ownerDb.booking.findUniqueOrThrow({ where: { id: personal.id } });
    expect([taken.hostUserId, taken.needsHost]).toEqual([owner.id, false]);
    // The meeting goes with it, the owner attends, and the guest hears who they'll meet.
    expect((await ownerDb.event.findUniqueOrThrow({ where: { id: personal.eventId } })).hostUserId).toBe(owner.id);
    expect((await ownerDb.eventAttendee.findFirstOrThrow({ where: { eventId: personal.eventId, userId: owner.id } })).rsvp).toBe("YES");
    sendMock.mockClear();
    await bookingEmailJob(run(crmOrg, { bookingId: personal.id, template: "host-changed", startsAt: personal.startsAt.toISOString() }));
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ to: `g-leave-b-${tag}@example.org`, subject: expect.stringMatching(/^New host/) });
  });

  it("says so when Take it lands on a time the taker already has booked", async () => {
    if (!reachable) return;
    const mine = await openLink(owner, plain);
    const theirs = await openLink(host, plain);
    const start = await slotsOf(mine.slug, 110);
    expect((await book(mine.slug, { start, ...guest("clash-a") })).ok).toBe(true);
    expect((await book(theirs.slug, { start, ...guest("clash-b") })).ok).toBe(true);
    const b = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: plain, guestEmail: `g-clash-b-${tag}@example.org` } });
    await expect(as(owner, plain, (ctx) => takeBooking(ctx, b.id))).rejects.toThrow("You already have a meeting booked at that time.");
    expect((await ownerDb.booking.findUniqueOrThrow({ where: { id: b.id } })).hostUserId).toBe(host.id);
  });

  it("closes organization links when the CRM comes off", async () => {
    if (!reachable) return;
    const link = await as(owner, crmOrg, (ctx) => createOrgLink(ctx, "Closing"));
    await as(owner, crmOrg, (ctx) => updateLink(ctx, link.id, { hours: ALL_DAY as never, minNoticeHours: 0 }));
    expect(await loadBooking(link.slug)).not.toBeNull();
    // The organization's own link doesn't depend on the CRM.
    await as(owner, crmOrg, (ctx) => ensureMainLink(ctx));
    const main = await ownerDb.crmBookingPage.findUniqueOrThrow({ where: { id: mainLinkId(crmOrg) } });
    await as(owner, crmOrg, (ctx) => updateLink(ctx, main.id, { hours: ALL_DAY as never, minNoticeHours: 0, active: true }));
    await ownerDb.orgSettings.update({ where: { organizationId: crmOrg }, data: { addOns: [] } });
    expect(await loadBooking(link.slug)).toBeNull();
    expect((await loadBooking(main.slug))?.main).toBe(true);
    await ownerDb.orgSettings.update({ where: { organizationId: crmOrg }, data: { addOns: ["crm"] } });
  });
});
