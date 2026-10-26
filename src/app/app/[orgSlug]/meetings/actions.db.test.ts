// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Try again" on a meeting whose video call failed, against the real
 * database (docs/features/meetings.md): who may ask, which meetings it
 * applies to, and what a retry leaves behind (the row PENDING, one
 * conference-sync job, and nothing else touched).
 *
 * Skipped when the local database is not reachable.
 */

const session = vi.hoisted(() => ({ requireUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  notifyUser: vi.fn(async () => undefined),
  notifyOrgOwners: vi.fn(async () => undefined),
}));

import { CalendarSyncState } from "@/generated/prisma/enums";
import { authDb, disconnectAll } from "@/server/db/clients";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { retryConferenceSync } from "./actions";

const tag = randomBytes(4).toString("hex");
const orgId = `c_rty_${tag}`;
const otherOrgId = `c_rty_other_${tag}`;
const DAY = 24 * 60 * 60 * 1000;
const NO_CALL = "This meeting has no video call to make.";

let adminId = "";
let memberId = "";
let strangerId = "";
let reachable = true;
/** Whether a database answered at all, as opposed to the fixture failing. */
let databaseUp = false;

/** Signs the next call in as this user. */
function signIn(userId: string) {
  session.requireUser.mockResolvedValue({ id: userId });
}

/** A Zoom meeting whose link could not be made: the case a retry exists for. */
async function makeEvent(data: Record<string, unknown> = {}, org = orgId) {
  const row = await ownerDb.event.create({
    data: {
      organizationId: org,
      title: "Exec sync",
      startsAt: new Date(Date.now() + DAY),
      endsAt: new Date(Date.now() + DAY + 60 * 60 * 1000),
      createdById: adminId,
      format: "ONLINE",
      conferenceProvider: "ZOOM",
      conferenceUrl: null,
      conferenceManaged: false,
      conferenceSyncState: CalendarSyncState.FAILED,
      conferenceSyncError: "Zoom is not connected for this organization.",
      ...data,
    },
    select: { id: true },
  });
  return row.id;
}

function readEvent(id: string) {
  return ownerDb.event.findFirstOrThrow({
    where: { id },
    select: { conferenceSyncState: true, conferenceSyncError: true, updatedAt: true },
  });
}

function jobsFor(eventId: string) {
  return ownerDb.job.findMany({
    where: { dedupeKey: `conference-sync:${eventId}` },
    select: { kind: true, dedupeKey: true, organizationId: true, status: true, payload: true },
  });
}

function allJobs() {
  return ownerDb.job.count({
    where: { organizationId: { in: [orgId, otherOrgId] }, kind: "conference-sync" },
  });
}

beforeAll(async () => {
  // A machine with no database (CI's lint job) skips; a database that is up
  // while this file's own setup is broken must fail loudly instead.
  try {
    await ownerDb.$queryRaw`select 1`;
    databaseUp = true;
  } catch {
    databaseUp = false;
  }
  if (!databaseUp) {
    reachable = false;
    return;
  }
  try {
    const make = async (role: string) =>
      (
        await authDb.user.create({
          data: {
            email: `retry-${role}-${tag}@example.edu`,
            name: `Retry ${role}`,
            emailVerified: new Date(),
            onboardedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
    adminId = await make("admin");
    memberId = await make("member");
    strangerId = await make("stranger");
    await ownerDb.organization.create({
      data: {
        id: orgId,
        name: "Retry Test Club",
        slug: `rty-club-${tag}`,
        timezone: "America/New_York",
      },
    });
    await ownerDb.organization.create({
      data: {
        id: otherOrgId,
        name: "Retry Other Club",
        slug: `rty-other-${tag}`,
        timezone: "America/New_York",
      },
    });
    await ownerDb.membership.create({
      data: { organizationId: orgId, userId: adminId, role: "ADMIN" },
    });
    await ownerDb.membership.create({
      data: { organizationId: orgId, userId: memberId, role: "MEMBER" },
    });
    // The stranger belongs to the other club only; the admin is its own owner there.
    await ownerDb.membership.create({
      data: { organizationId: otherOrgId, userId: strangerId, role: "OWNER" },
    });
  } catch (error) {
    reachable = false;
    // Loudly, so a broken setup never looks like a green run.
    console.warn(`[actions.db.test] database not reachable, skipping: ${String(error)}`);
  }
});

beforeEach(() => {
  session.requireUser.mockReset();
});

afterEach(async () => {
  // Each case counts jobs for the whole org, so each starts with none.
  if (!reachable) return;
  await ownerDb.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await ownerDb.event.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await ownerDb.user.deleteMany({ where: { id: { in: [adminId, memberId, strangerId] } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the test setup itself", () => {
  it("either skips because there is no database, or is really talking to one", () => {
    if (!databaseUp) {
      expect(reachable).toBe(false);
      return;
    }
    // A database answered, so the fixture had no excuse: if it threw, these
    // tests would all have "passed" without running.
    expect(reachable, "the database is up, so this file's setup must have built").toBe(true);
    expect(adminId).not.toBe("");
  });
});

describe("retryConferenceSync: who may ask", () => {
  it("an admin retrying a FAILED Zoom meeting sets it PENDING and queues the job", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent();
    const before = await readEvent(eventId);

    expect(await retryConferenceSync(orgId, eventId)).toEqual({});

    const after = await readEvent(eventId);
    expect(after.conferenceSyncState).toBe(CalendarSyncState.PENDING);
    // Marking it PENDING is not an edit.
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const jobs = await jobsFor(eventId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: "conference-sync",
      dedupeKey: `conference-sync:${eventId}`,
      organizationId: orgId,
      status: "PENDING",
      payload: { eventId },
    });
  });

  it("a member gets an error and nothing changes", async () => {
    if (!reachable) return;
    signIn(memberId);
    const eventId = await makeEvent();
    const before = await readEvent(eventId);

    const result = await retryConferenceSync(orgId, eventId);

    expect(result).toEqual({ error: "You don't have permission to do that." });
    const after = await readEvent(eventId);
    expect(after.conferenceSyncState).toBe(CalendarSyncState.FAILED);
    expect(after.conferenceSyncError).toBe(before.conferenceSyncError);
    expect(await allJobs()).toBe(0);
  });

  it("someone outside the organization gets an error and nothing changes", async () => {
    if (!reachable) return;
    // An owner of ANOTHER club, aiming at this club's meeting.
    signIn(strangerId);
    const eventId = await makeEvent();

    const result = await retryConferenceSync(orgId, eventId);

    expect(result.error).toBeTruthy();
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.FAILED);
    expect(await allJobs()).toBe(0);
  });

  it("an admin cannot retry another organization's meeting by naming its id", async () => {
    if (!reachable) return;
    signIn(adminId);
    const theirs = await makeEvent({}, otherOrgId);

    const result = await retryConferenceSync(orgId, theirs);

    expect(result).toEqual({ error: "That meeting no longer exists." });
    expect((await readEvent(theirs)).conferenceSyncState).toBe(CalendarSyncState.FAILED);
    expect(await allJobs()).toBe(0);
  });
});

describe("retryConferenceSync: which meetings", () => {
  it("an in-person meeting has no video call to make", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent({
      format: "IN_PERSON",
      location: "Curry 342",
      conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
      conferenceSyncError: null,
    });

    expect(await retryConferenceSync(orgId, eventId)).toEqual({ error: NO_CALL });

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await allJobs()).toBe(0);
  });

  it("a meeting with no kind of call has none to make", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent({
      conferenceProvider: "NONE",
      conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
    });

    expect(await retryConferenceSync(orgId, eventId)).toEqual({ error: NO_CALL });

    expect(await allJobs()).toBe(0);
  });

  it("a pasted OTHER link is not ours to make", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent({
      conferenceProvider: "OTHER",
      conferenceUrl: "https://meet.example.org/board",
      conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
      conferenceSyncError: null,
    });

    expect(await retryConferenceSync(orgId, eventId)).toEqual({ error: NO_CALL });

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await allJobs()).toBe(0);
  });

  it("a pasted Zoom link is not ours to replace either", async () => {
    if (!reachable) return;
    signIn(adminId);
    // Left FAILED by a job that ran before someone pasted a link over it.
    const eventId = await makeEvent({
      conferenceUrl: "https://us02web.zoom.us/j/manual",
      conferenceManaged: false,
    });

    expect(await retryConferenceSync(orgId, eventId)).toEqual({ error: NO_CALL });

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.FAILED);
    expect(await allJobs()).toBe(0);
  });

  it("a deleted meeting no longer exists", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent({ deletedAt: new Date() });

    expect(await retryConferenceSync(orgId, eventId)).toEqual({
      error: "That meeting no longer exists.",
    });

    expect(await allJobs()).toBe(0);
  });

  it("retries a meeting we made whose update failed, link and all", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent({
      conferenceManaged: true,
      conferenceManagedAt: "ZOOM",
      conferenceMeetingId: "98765432100",
      conferenceUrl: "https://us02web.zoom.us/j/98765432100",
    });

    expect(await retryConferenceSync(orgId, eventId)).toEqual({});

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.PENDING);
    expect(await jobsFor(eventId)).toHaveLength(1);
  });

  it("asking twice queues one job", async () => {
    if (!reachable) return;
    signIn(adminId);
    const eventId = await makeEvent();

    expect(await retryConferenceSync(orgId, eventId)).toEqual({});
    expect(await retryConferenceSync(orgId, eventId)).toEqual({});

    expect(await jobsFor(eventId)).toHaveLength(1);
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.PENDING);
  });
});
