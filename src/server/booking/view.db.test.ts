// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Booking links' page against the real roles and policies on the local
 * database (docs/features/booking.md): what the loader hands each member of
 * everyone else's link, Ask them, and every booked meeting showing up on
 * Meetings and the Calendar by itself. Skipped when the database is not
 * reachable.
 */

process.env.EMAIL_DELIVERY = "sink";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { getEventsInRange } from "@/app/app/[orgSlug]/calendar/queries";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { meetingsWhere } from "@/server/meetings/where";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { book, loadBooking } from "./book";
import { coHostedEventIds } from "./co-hosted";
import { askToTurnOn, createOrgLink, ensurePersonalLink, updateLink } from "./links";
import { loadBookingLinks } from "./view";

const tag = randomBytes(4).toString("hex");
const crmOrg = `c_bview_${tag}`;
const plainOrg = `c_bviewp_${tag}`;
const personalOrg = `c_bviewme_${tag}`;
const ALL_DAY = { "1": [[0, 1440]], "2": [[0, 1440]], "3": [[0, 1440]], "4": [[0, 1440]], "5": [[0, 1440]], "6": [[0, 1440]], "7": [[0, 1440]] } as const;

type U = { id: string; email: string; name: string };
let owner: U;
let ana: U;
let bo: U;
let cy: U;
let outsider: U;
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

async function openLink(user: U, org: string) {
  const link = await as(user, org, (ctx) => ensurePersonalLink(ctx));
  await as(user, org, (ctx) =>
    updateLink(ctx, link.id, { hours: ALL_DAY as never, minNoticeHours: 0, maxDaysAhead: 7, durationMin: 30, bufferMin: 0, timezone: "UTC", video: false, active: true }),
  );
  return link;
}

async function slotOf(slug: string, i: number): Promise<string> {
  const s = (await loadBooking(slug))?.slots[30]?.[i];
  if (!s) throw new Error("no slots");
  return s;
}

const guest = (n: string) => ({ name: `Guest ${n}`, email: `g-${n}-${tag}@example.org`, answers: {} });
const bookingOf = (n: string) => ownerDb.booking.findFirstOrThrow({ where: { guestEmail: `g-${n}-${tag}@example.org` } });

/** What the Meetings tab lists for this member, and the number on the tab. */
async function meetingsFor(user: U, org: string, canManage: boolean) {
  const now = new Date();
  const coHosted = canManage ? [] : await coHostedEventIds(org, user.id, now);
  return as(user, org, async ({ db }) => {
    const where = meetingsWhere(org, user.id, canManage, now, coHosted);
    const rows = await db.event.findMany({ where, select: { id: true } });
    const count = await db.event.count({ where: { AND: [where, { endsAt: { gt: now } }] } });
    return { ids: rows.map((r) => r.id), count };
  });
}

/** What this member's Calendar shows over the next two weeks. */
function calendarFor(user: U, org: string) {
  const from = new Date();
  const to = new Date(from.getTime() + 14 * 86_400_000);
  return as(user, org, async ({ db }) => (await getEventsInRange(db, org, { from, to })).map((e) => e.id));
}

beforeAll(async () => {
  try {
    owner = await makeUser("view-owner");
    ana = await makeUser("view-ana");
    bo = await makeUser("view-bo");
    cy = await makeUser("view-cy");
    outsider = await makeUser("view-outsider");
    await ownerDb.organization.createMany({
      data: [
        { id: crmOrg, name: "View CRM", slug: `bview-${tag}`, timezone: "UTC", plan: "SOCIETY" },
        { id: plainOrg, name: "View Plain", slug: `bviewp-${tag}`, timezone: "UTC", plan: "SOCIETY" },
        { id: personalOrg, name: "Ana's space", slug: `bviewme-${tag}`, timezone: "UTC", kind: "PERSONAL", plan: "FREE", personalOwnerId: ana.id },
      ],
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: crmOrg, userId: owner.id, role: "OWNER" },
        { organizationId: crmOrg, userId: ana.id, role: "MEMBER", title: "Co-founder" },
        { organizationId: crmOrg, userId: bo.id, role: "MEMBER" },
        { organizationId: crmOrg, userId: cy.id, role: "MEMBER" },
        { organizationId: plainOrg, userId: ana.id, role: "MEMBER" },
        { organizationId: plainOrg, userId: bo.id, role: "MEMBER" },
        { organizationId: personalOrg, userId: ana.id, role: "OWNER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: crmOrg },
      create: { organizationId: crmOrg, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [crmOrg, plainOrg, personalOrg] } } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, ana, bo, cy, outsider].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("Booking links' page", () => {
  it("shows every member, with nothing of a link that's off, and only public facts of one that's on", async () => {
    if (!reachable) return;
    const anaLink = await openLink(ana, crmOrg);
    // Bo opened the page once, so has a link, and left it off. Cy never has.
    const boLink = await as(bo, crmOrg, (ctx) => ensurePersonalLink(ctx));
    await ownerDb.crmBookingPage.update({ where: { id: boLink.id }, data: { title: "Bo's secret hours", dateOverrides: [{ date: "2099-01-01", ranges: [] }] } });

    const data = await as(owner, crmOrg, (ctx) => loadBookingLinks(ctx));
    expect(data.people.map((p) => p.id)).toEqual([owner.id, ana.id, bo.id, cy.id]);
    const anaCard = data.people[1]!;
    expect(anaCard.title).toBe("Co-founder");
    expect(anaCard.link?.url).toContain(`/book/${anaLink.slug}`);
    expect(anaCard.link?.week).toHaveLength(7);
    expect(anaCard.link?.openSoon).toBeGreaterThan(0);
    expect(anaCard.link?.nextOpen).toBeTruthy();
    expect(data.people[2]?.link).toBeNull();
    expect(data.people[3]?.link).toBeNull();

    // Nothing else of theirs reaches the browser: no address, no off link, no questions.
    const sent = JSON.stringify(data.people);
    expect(sent).not.toContain(boLink.slug);
    expect(sent).not.toContain("secret hours");
    expect(sent).not.toContain("2099-01-01");
    expect(sent).not.toContain("@example.edu");
    expect(sent).not.toContain("What would you like");
  });

  it("puts you first, then links that are on, and keeps your own off card in the grid", async () => {
    if (!reachable) return;
    const data = await as(cy, crmOrg, (ctx) => loadBookingLinks(ctx));
    expect(data.people[0]).toMatchObject({ id: cy.id, me: true });
    expect(data.people[1]?.id).toBe(ana.id);
    // A plain member reads another member's link.
    expect(data.people[1]?.link?.url).toContain("/book/");
    expect(data.mine.ambient.map((a) => a.kind)).toEqual(["turn-on"]);
    expect(data.mine.active).toBe(false);
    // Opening the page is what makes a link.
    expect(await ownerDb.crmBookingPage.count({ where: { organizationId: crmOrg, ownerUserId: cy.id } })).toBe(1);
  });

  it("has no grid in a Personal space, and your week comes with the link", async () => {
    if (!reachable) return;
    const data = await as(ana, personalOrg, (ctx) => loadBookingLinks(ctx));
    expect(data.access.personal).toBe(true);
    expect(data.people).toEqual([]);
    expect(data.org).toEqual([]);
    expect(data.mine.week).toHaveLength(7);
    expect(data.mine.hoursLine).toBe("Mon to Fri, 9 AM to 5 PM");
  });

  it("counts a link's bookings for a member who doesn't host them, without showing them the bookings", async () => {
    if (!reachable) return;
    const link = await as(owner, crmOrg, (ctx) => createOrgLink(ctx, "Coffee"));
    await as(owner, crmOrg, (ctx) =>
      updateLink(ctx, link.id, { hours: ALL_DAY as never, timezone: "UTC", minNoticeHours: 0, maxDaysAhead: 7, video: false }),
    );
    let seen = await as(cy, crmOrg, (ctx) => loadBookingLinks(ctx));
    expect(seen.org.find((l) => l.id === link.id)?.ambient.map((a) => a.kind)).toEqual(["signature"]);

    expect((await book(link.slug, { start: await slotOf(link.slug, 3), ...guest("coffee") })).ok).toBe(true);
    seen = await as(cy, crmOrg, (ctx) => loadBookingLinks(ctx));
    const coffee = seen.org.find((l) => l.id === link.id);
    expect(coffee?.booked).toBe(1);
    expect(coffee?.ambient).toEqual([]);
    expect(coffee?.canEdit).toBe(false);
    expect(seen.upcoming).toEqual([]);

    // The host's Coming up has it, with their face and no guest address.
    const host = await as(owner, crmOrg, (ctx) => loadBookingLinks(ctx));
    const row = host.upcoming.find((b) => b.guestName === "Guest coffee");
    expect(row).toMatchObject({ mine: true, linkTitle: "Coffee", verified: false, joinUrl: null });
    expect(row?.host.name).toBe(owner.name);
    expect(row?.waiting).toMatch(/hasn't confirmed/);
    expect(JSON.stringify(host.upcoming)).not.toContain("@example.org");
  });

  it("leaves organization links out without the CRM, and still shows everyone", async () => {
    if (!reachable) return;
    const data = await as(ana, plainOrg, (ctx) => loadBookingLinks(ctx));
    expect(data.access.orgLinks).toBe(false);
    expect(data.org).toEqual([]);
    expect(data.people.map((p) => p.id).sort()).toEqual([ana.id, bo.id].sort());
  });
});

describe("Ask them", () => {
  it("sends one Inbox line however many people ask, and the button goes for everyone", async () => {
    if (!reachable) return;
    const before = await as(ana, crmOrg, (ctx) => loadBookingLinks(ctx));
    expect(before.people.find((p) => p.id === bo.id)?.asked).toBe(false);

    await as(ana, crmOrg, (ctx) => askToTurnOn(ctx, bo.id));
    await as(ana, crmOrg, (ctx) => askToTurnOn(ctx, bo.id));
    await as(owner, crmOrg, (ctx) => askToTurnOn(ctx, bo.id));

    const notes = await ownerDb.notification.findMany({ where: { organizationId: crmOrg, userId: bo.id, type: "MEETING_BOOKED" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe(`${ana.name} asked you to turn on your booking link`);
    expect(notes[0]?.linkUrl).toContain("/meetings/booking");

    for (const viewer of [ana, owner, cy]) {
      const data = await as(viewer, crmOrg, (ctx) => loadBookingLinks(ctx));
      expect(data.people.find((p) => p.id === bo.id)?.asked).toBe(true);
    }
    // Someone else hasn't been asked.
    const data = await as(ana, crmOrg, (ctx) => loadBookingLinks(ctx));
    expect(data.people.find((p) => p.id === cy.id)?.asked).toBe(false);
  });

  it("keeps each space's ask its own", async () => {
    if (!reachable) return;
    await as(ana, plainOrg, (ctx) => askToTurnOn(ctx, bo.id));
    expect(await ownerDb.notification.count({ where: { organizationId: plainOrg, userId: bo.id, type: "MEETING_BOOKED" } })).toBe(1);
  });

  it("works for someone who has never opened the page, and refuses what makes no sense", async () => {
    if (!reachable) return;
    await ownerDb.crmBookingPage.deleteMany({ where: { organizationId: crmOrg, ownerUserId: cy.id } });
    await as(ana, crmOrg, (ctx) => askToTurnOn(ctx, cy.id));
    expect(await ownerDb.notification.count({ where: { organizationId: crmOrg, userId: cy.id, type: "MEETING_BOOKED" } })).toBe(1);

    await expect(as(ana, crmOrg, (ctx) => askToTurnOn(ctx, ana.id))).rejects.toThrow(/own/);
    await expect(as(bo, crmOrg, (ctx) => askToTurnOn(ctx, ana.id))).rejects.toThrow(/already on/);
    await expect(as(ana, crmOrg, (ctx) => askToTurnOn(ctx, outsider.id))).rejects.toThrow(/organization/);
  });
});

describe("a booked meeting shows up by itself", () => {
  it("on a personal link: on Meetings for the host and for admins, on everyone's Calendar, and the tab's number agrees", async () => {
    if (!reachable) return;
    const link = await openLink(ana, crmOrg);
    expect((await book(link.slug, { start: await slotOf(link.slug, 5), ...guest("own") })).ok).toBe(true);
    const { eventId } = await bookingOf("own");

    const forHost = await meetingsFor(ana, crmOrg, false);
    expect(forHost.ids).toContain(eventId);
    expect(forHost.count).toBe(forHost.ids.length);
    expect((await meetingsFor(owner, crmOrg, true)).ids).toContain(eventId);
    // In person with nothing to join, it isn't someone else's to act on.
    expect((await meetingsFor(bo, crmOrg, false)).ids).not.toContain(eventId);
    for (const viewer of [ana, owner, bo]) expect(await calendarFor(viewer, crmOrg)).toContain(eventId);
  });

  it("on a shared link: the host attends, and the other hosts see it on Meetings without being blocked", async () => {
    if (!reachable) return;
    const link = await as(owner, crmOrg, (ctx) => createOrgLink(ctx, "Office hours"));
    await as(owner, crmOrg, (ctx) =>
      updateLink(ctx, link.id, { hours: ALL_DAY as never, timezone: "UTC", minNoticeHours: 0, maxDaysAhead: 7, video: false, hostIds: [ana.id, bo.id] }),
    );
    const start = await slotOf(link.slug, 9);
    expect((await book(link.slug, { start, ...guest("shared") })).ok).toBe(true);
    const b = await bookingOf("shared");
    const [host, coHost] = b.hostUserId === ana.id ? [ana, bo] : [bo, ana];

    const forHost = await meetingsFor(host, crmOrg, false);
    expect(forHost.ids).toContain(b.eventId);
    const forCoHost = await meetingsFor(coHost, crmOrg, false);
    expect(forCoHost.ids).toContain(b.eventId);
    expect(forCoHost.count).toBe(forCoHost.ids.length);
    expect(await calendarFor(coHost, crmOrg)).toContain(b.eventId);
    // Someone else in the organization doesn't have it on their list.
    expect((await meetingsFor(cy, crmOrg, false)).ids).not.toContain(b.eventId);

    // The other host wasn't asked to it, so that time is still theirs.
    expect(await ownerDb.eventAttendee.count({ where: { eventId: b.eventId, userId: coHost.id } })).toBe(0);
    expect((await book(link.slug, { start, ...guest("second") })).ok).toBe(true);
    expect((await bookingOf("second")).hostUserId).toBe(coHost.id);

    // Only ids come out of the service path, and only for what's still on.
    expect(await coHostedEventIds(crmOrg, cy.id, new Date())).toEqual([]);
    await ownerDb.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    expect(await coHostedEventIds(crmOrg, coHost.id, new Date())).not.toContain(b.eventId);
  });

  it("in a Personal space: on its own Meetings and Calendar", async () => {
    if (!reachable) return;
    const link = await openLink(ana, personalOrg);
    expect((await book(link.slug, { start: await slotOf(link.slug, 1), ...guest("me") })).ok).toBe(true);
    const { eventId } = await bookingOf("me");
    expect((await meetingsFor(ana, personalOrg, true)).ids).toContain(eventId);
    expect(await calendarFor(ana, personalOrg)).toContain(eventId);
  });
});
