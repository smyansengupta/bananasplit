// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Connecting (or reconnecting) a provider queues the meetings that were
 * waiting for it, against the real database (docs/features/meetings.md).
 *
 * A meeting saved before its provider was connected is skipped by the save
 * path and would stay without a link forever; one left FAILED by an expired
 * grant is never retried. Both are picked up here, and nothing else is:
 * a pasted link, a past meeting, a deleted one, an in-person row, another
 * provider's meeting, or another organization's.
 *
 * Skipped when the local database is not reachable.
 */

// The transaction wrappers import the session module, which pulls in next-auth;
// requeueWaitingMeetings uses the service path and never asks for a session.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { CalendarSyncState } from "@/generated/prisma/enums";
import { authDb, disconnectAll } from "@/server/db/clients";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { requeueWaitingMeetings } from "./requeue";

const tag = randomBytes(4).toString("hex");
const orgId = `c_rq_${tag}`;
const otherOrgId = `c_rq_other_${tag}`;
const DAY = 24 * 60 * 60 * 1000;

let userId = "";
let reachable = true;
/** Whether a database answered at all, as opposed to the fixture failing. */
let databaseUp = false;

/** An online Zoom meeting that was saved before Zoom was connected. */
async function makeEvent(data: Record<string, unknown> = {}, org = orgId) {
  const row = await ownerDb.event.create({
    data: {
      organizationId: org,
      title: "Exec sync",
      startsAt: new Date(Date.now() + DAY),
      endsAt: new Date(Date.now() + DAY + 60 * 60 * 1000),
      createdById: userId,
      format: "ONLINE",
      conferenceProvider: "ZOOM",
      conferenceUrl: null,
      conferenceManaged: false,
      conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
      ...data,
    },
    select: { id: true },
  });
  return row.id;
}

function readEvent(id: string) {
  return ownerDb.event.findFirstOrThrow({
    where: { id },
    select: { conferenceSyncState: true, updatedAt: true },
  });
}

function jobsFor(eventId: string) {
  return ownerDb.job.findMany({
    where: { dedupeKey: `conference-sync:${eventId}` },
    select: { kind: true, dedupeKey: true, organizationId: true, status: true, payload: true },
  });
}

function allJobs(org = orgId) {
  return ownerDb.job.count({ where: { organizationId: org, kind: "conference-sync" } });
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
    const user = await authDb.user.create({
      data: {
        email: `requeue-${tag}@example.edu`,
        name: "Requeue Admin",
        emailVerified: new Date(),
        onboardedAt: new Date(),
      },
      select: { id: true },
    });
    userId = user.id;
    await ownerDb.organization.create({
      data: {
        id: orgId,
        name: "Requeue Test Club",
        slug: `rq-club-${tag}`,
        timezone: "America/New_York",
      },
    });
    await ownerDb.organization.create({
      data: {
        id: otherOrgId,
        name: "Requeue Other Club",
        slug: `rq-other-${tag}`,
        timezone: "America/New_York",
      },
    });
  } catch (error) {
    reachable = false;
    console.warn(`[requeue.db.test] database not reachable, skipping: ${String(error)}`);
  }
});

afterEach(async () => {
  // Each case counts what the call returned for the whole org, so each one
  // starts from an org with no events and no jobs.
  if (!reachable) return;
  await ownerDb.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await ownerDb.event.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await ownerDb.user.deleteMany({ where: { id: userId } });
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
    expect(userId).not.toBe("");
  });
});

describe("meetings that are picked up", () => {
  it("requeues an online meeting saved before Zoom was connected", async () => {
    if (!reachable) return;
    const eventId = await makeEvent();

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(1);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.PENDING);
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

  it("requeues a FAILED meeting", async () => {
    if (!reachable) return;
    const eventId = await makeEvent({
      conferenceSyncState: CalendarSyncState.FAILED,
      conferenceManaged: true,
      conferenceManagedAt: "ZOOM",
      conferenceMeetingId: "98765432100",
      conferenceUrl: "https://us02web.zoom.us/j/98765432100",
    });

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(1);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.PENDING);
    expect(await jobsFor(eventId)).toHaveLength(1);
  });
});

describe("meetings that are left alone", () => {
  it("leaves a pasted link alone", async () => {
    if (!reachable) return;
    const eventId = await makeEvent({
      conferenceUrl: "https://us02web.zoom.us/j/manual",
      conferenceManaged: false,
    });

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(0);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await allJobs()).toBe(0);
  });

  it("skips past meetings", async () => {
    if (!reachable) return;
    const eventId = await makeEvent({
      startsAt: new Date(Date.now() - 2 * DAY),
      endsAt: new Date(Date.now() - 2 * DAY + 3600_000),
    });

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(0);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await allJobs()).toBe(0);
  });

  it("skips deleted and merged meetings", async () => {
    if (!reachable) return;
    const keeper = await makeEvent({ conferenceProvider: "NONE", format: "IN_PERSON" });
    await makeEvent({ deletedAt: new Date() });
    await makeEvent({ deletedAt: new Date(), mergedIntoId: keeper });
    await makeEvent({ mergedIntoId: keeper });
    await makeEvent({
      conferenceSyncState: CalendarSyncState.FAILED,
      deletedAt: new Date(),
    });

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(0);
    expect(await allJobs()).toBe(0);
  });

  it("skips in-person rows", async () => {
    if (!reachable) return;
    // A row left on ZOOM after the meeting became in person must not get a
    // link made for it.
    const eventId = await makeEvent({ format: "IN_PERSON", location: "Curry 342" });
    const failed = await makeEvent({
      format: "IN_PERSON",
      location: "Curry 342",
      conferenceSyncState: CalendarSyncState.FAILED,
    });

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(0);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect((await readEvent(failed)).conferenceSyncState).toBe(CalendarSyncState.FAILED);
    expect(await allJobs()).toBe(0);
  });

  it("skips other providers", async () => {
    if (!reachable) return;
    const eventId = await makeEvent({ conferenceProvider: "MEET" });

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(0);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await allJobs()).toBe(0);
  });

  it("stays inside the org", async () => {
    if (!reachable) return;
    const theirs = await makeEvent({}, otherOrgId);

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(0);

    expect((await readEvent(theirs)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await allJobs(otherOrgId)).toBe(0);
    expect(await allJobs()).toBe(0);
  });
});

describe("what the update leaves alone", () => {
  it("does not touch updatedAt", async () => {
    if (!reachable) return;
    const eventId = await makeEvent();
    const before = await readEvent(eventId);

    expect(await requeueWaitingMeetings(orgId, "ZOOM")).toBe(1);

    const after = await readEvent(eventId);
    expect(after.conferenceSyncState).toBe(CalendarSyncState.PENDING);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});
