// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Personal dashboard against the real roles and policies on the local
 * database: everything is read as Maya (one withOrgTx per space she's in,
 * and app.my_rsvp_registrations for public pages), so it must gather her
 * clubs' events, tasks and polls and leave out a club she isn't in, a
 * private task that isn't hers, and other people's sign-ups. Throwaway
 * users and clubs are made as the table owner and removed in afterAll.
 * Skipped when the database is not reachable, like the other *.db.test.ts.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withUserTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { loadPersonalHome } from "./home";
import { ensurePersonalSpace } from "./space";

const tag = randomBytes(4).toString("hex");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const clubA = `c_home_a_${tag}`;
const clubB = `c_home_b_${tag}`;
const outside = `c_home_x_${tag}`;
const orgIds = [clubA, clubB, outside];

interface U {
  id: string;
  email: string;
}
let maya: U;
let boss: U;
let stranger: U;
let personalId = "";
let reachable = true;

async function makeUser(local: string, name: string): Promise<U> {
  return authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name,
      emailVerified: new Date(),
      onboardedAt: new Date(),
      timezone: "America/Chicago",
      major: "Physics",
      bio: "Hello",
    },
    select: { id: true, email: true },
  });
}

function code(n: number, prefix: string): string {
  return `${prefix}${tag}`.padEnd(n, "0").slice(0, n);
}

beforeAll(async () => {
  try {
    maya = await makeUser("maya", "Maya Patel");
    boss = await makeUser("boss", "Boss Person");
    stranger = await makeUser("stranger", "Stranger");
  } catch {
    reachable = false;
    return;
  }
  const now = Date.now();
  for (const [id, name] of [
    [clubA, "Alpha Club"],
    [clubB, "Beta Club"],
    [outside, "Outside Club"],
  ] as const) {
    await ownerDb.organization.create({
      data: { id, name, slug: `${id.replace(/_/g, "-")}`, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.create({
      data: { organizationId: id, userId: boss.id, role: "OWNER" },
    });
  }
  await ownerDb.membership.create({
    data: { organizationId: clubA, userId: maya.id, role: "MEMBER", title: "Treasurer" },
  });
  await ownerDb.membership.create({
    data: { organizationId: clubB, userId: maya.id, role: "MEMBER" },
  });
  personalId = (await ensurePersonalSpace(maya.id)).id;

  const event = (organizationId: string, title: string, inHours: number, extra = {}) =>
    ownerDb.event.create({
      data: {
        organizationId,
        title,
        startsAt: new Date(now + inHours * HOUR),
        endsAt: new Date(now + (inHours + 1) * HOUR),
        createdById: organizationId === personalId ? maya.id : boss.id,
        ...extra,
      },
      select: { id: true },
    });
  await event(clubA, "Alpha weekly meeting", 48);
  await event(clubB, "Beta social", 24);
  await event(personalId, "Dentist", 5);
  await event(outside, "Outside secret", 3);
  await event(clubA, "Too far away", 20 * 24);
  const hostedPage = await event(personalId, "Maya's party", 72, {
    rsvpEnabled: true,
    rsvpSlug: code(8, "p"),
  });
  const outsidePage = await event(outside, "Outside open day", 30, {
    rsvpEnabled: true,
    rsvpSlug: code(8, "o"),
    visibility: "PUBLIC",
  });

  const tomorrow = new Date(new Date(now + DAY).toISOString().slice(0, 10) + "T00:00:00Z");
  const task = (organizationId: string, title: string, ownerId: string, extra = {}) =>
    ownerDb.task.create({
      data: {
        organizationId,
        title,
        rank: "a0",
        createdById: ownerId,
        ownerId,
        dueDate: tomorrow,
        ...extra,
      },
    });
  await task(clubA, "Alpha budget", maya.id);
  await task(clubA, "Boss private", boss.id, { visibility: "PRIVATE" });
  await task(clubA, "Boss open", boss.id);
  await task(clubB, "Beta far", maya.id, { dueDate: new Date(now + 30 * DAY) });
  await task(personalId, "Call mom", maya.id);

  const poll = (organizationId: string, title: string, createdById: string) =>
    ownerDb.availabilityPoll.create({
      data: { organizationId, title, timezone: "UTC", durationMinutes: 60, createdById },
      select: { id: true },
    });
  const slot = (organizationId: string, pollId: string) =>
    ownerDb.pollSlot.create({
      data: {
        organizationId,
        pollId,
        startsAt: new Date(now + 3 * DAY),
        endsAt: new Date(now + 3 * DAY + HOUR),
      },
      select: { id: true },
    });
  const kickoff = await poll(clubA, "Alpha kickoff time", boss.id);
  await slot(clubA, kickoff.id);
  const own = await poll(personalId, "Study group", maya.id);
  const ownSlot = await slot(personalId, own.id);
  await ownerDb.pollResponse.create({
    data: {
      organizationId: personalId,
      pollId: own.id,
      slotId: ownSlot.id,
      guestName: "Sam",
      guestKeyHash: `k${tag}`,
      availability: "YES",
    },
  });

  await ownerDb.notification.create({
    data: { organizationId: clubA, userId: maya.id, type: "TASK_ASSIGNED", title: "New task" },
  });

  // Signed up signed out, with her email, to a club she isn't in; and a
  // stranger's sign-up to the same page, which she must never see.
  const registration = (eventId: string, organizationId: string, email: string, n: string) =>
    ownerDb.eventRegistration.create({
      data: {
        organizationId,
        eventId,
        name: "Someone",
        email,
        phone: "+15551234567",
        inviteCode: code(8, `i${n}`),
        ticketCode: code(12, `t${n}`),
      },
    });
  await registration(outsidePage.id, outside, maya.email, "1");
  await registration(outsidePage.id, outside, stranger.email, "2");
  await registration(hostedPage.id, personalId, stranger.email, "3");
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [...orgIds, personalId] } } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [maya, boss, stranger].map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("loadPersonalHome against the local database", () => {
  it("gathers Maya's organizations and Personal, and nothing from an organization she isn't in", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue({ id: maya.id, email: maya.email, name: "Maya Patel" });
    const data = await loadPersonalHome(maya.id);

    expect(data.firstName).toBe("Maya");
    expect(data.clubs.map((c) => [c.name, c.title, c.openTasks, c.unread])).toEqual([
      ["Alpha Club", "Treasurer", 1, 1],
      ["Beta Club", null, 1, 0],
    ]);
    expect(data.clubs[0].nextMeeting?.title).toBe("Alpha weekly meeting");

    expect(data.upcoming.map((e) => [e.title, e.space.name])).toEqual([
      ["Dentist", "Personal"],
      ["Beta social", "Beta Club"],
      ["Alpha weekly meeting", "Alpha Club"],
      ["Maya's party", "Personal"],
    ]);

    // Hers in the clubs, everything open in Personal; not the boss's (open
    // or private), not the one due next month.
    expect(data.dueSoon.map((t) => [t.title, t.space.name]).sort()).toEqual([
      ["Alpha budget", "Alpha Club"],
      ["Call mom", "Personal"],
    ]);

    expect(data.pollsWaiting.map((p) => [p.title, p.space.name])).toEqual([
      ["Alpha kickoff time", "Alpha Club"],
    ]);
    expect(data.ownPolls.map((p) => [p.title, p.respondents])).toEqual([["Study group", 1]]);

    expect(data.rsvps).toEqual([
      expect.objectContaining({
        title: "Outside open day",
        status: "GOING",
        host: "Outside Club",
        ticketHref: expect.stringMatching(/^\/e\/[a-z0-9]{8}\/t\/t1/),
      }),
    ]);
    expect(data.hosting).toEqual([
      expect.objectContaining({ title: "Maya's party", going: 1, waitlist: 0, enabled: true }),
    ]);
    // Bio and school are filled in; no availability saved yet.
    expect(data.profileGaps).toEqual(["availability"]);
  });

  it("returns only the caller's own sign-ups from app.my_rsvp_registrations", async () => {
    if (!reachable) return;
    const rows = await withUserTx(
      boss.id,
      ({ db }) =>
        db.$queryRaw<{ title: string }[]>`SELECT "title" FROM app.my_rsvp_registrations(10)`,
    );
    expect(rows).toEqual([]);
    const theirs = await withUserTx(
      stranger.id,
      ({ db }) =>
        db.$queryRaw<
          { title: string }[]
        >`SELECT "title" FROM app.my_rsvp_registrations(10) ORDER BY 1`,
    );
    expect(theirs.map((r) => r.title)).toEqual(["Maya's party", "Outside open day"]);
  });
});
