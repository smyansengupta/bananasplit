// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The calendar action a person's Save goes through, against the real
 * database (docs/features/meetings.md): a Zoom meeting with no link pasted is
 * "make it for me", so it saves, waits PENDING and queues the conference-sync
 * job that makes it.
 *
 * The action's own unit tests mock the service, and the service's db tests
 * skip the action, so neither would have seen the action refuse an empty link
 * ("Paste a meeting link") while the service accepted it. That refusal made
 * every provider-made meeting impossible to save from the UI.
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

import { CalendarSyncState, IntegrationStatus } from "@/generated/prisma/enums";
import { authDb, disconnectAll } from "@/server/db/clients";
import { setSecret } from "@/server/secrets";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createEvent } from "./actions";

const tag = randomBytes(4).toString("hex");
const orgId = `c_calact_${tag}`;
const DAY = 24 * 60 * 60 * 1000;

let adminId = "";
let reachable = true;
/** Whether a database answered at all, as opposed to the fixture failing. */
let databaseUp = false;

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
        email: `calact-admin-${tag}@example.edu`,
        name: "Calendar Admin",
        emailVerified: new Date(),
        onboardedAt: new Date(),
      },
      select: { id: true },
    });
    adminId = user.id;
    // withOrgAction opens as the session user; this test is that admin.
    session.requireUser.mockResolvedValue({ id: adminId });
    await ownerDb.organization.create({
      data: {
        id: orgId,
        name: "Calendar Action Club",
        slug: `calact-club-${tag}`,
        timezone: "America/New_York",
      },
    });
    await ownerDb.membership.create({
      data: { organizationId: orgId, userId: adminId, role: "ADMIN" },
    });
    // Zoom connected the way the OAuth callback leaves it: the save path only
    // queues the job for a provider that is CONNECTED.
    await setSecret({
      orgId,
      actor: { userId: adminId, role: "ADMIN" },
      provider: "ZOOM",
      kind: "REFRESH_TOKEN",
      value: `rt_${randomBytes(8).toString("hex")}`,
      status: IntegrationStatus.CONNECTED,
      config: { accountEmail: "club@example.org", scopes: ["meeting:write:meeting"] },
    });
  } catch (error) {
    reachable = false;
    console.warn(`[calendar actions.db.test] database not reachable, skipping: ${String(error)}`);
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
    await ownerDb.organization.deleteMany({ where: { id: orgId } });
    await ownerDb.user.deleteMany({ where: { id: adminId } });
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
    expect(reachable, "the database is up, so this file's setup must have built").toBe(true);
    expect(adminId).not.toBe("");
  });
});

describe("the path a person actually takes", () => {
  it("saves a Zoom meeting with no link from the calendar action, PENDING with its job queued", async () => {
    if (!reachable) return;
    const start = Date.now() + DAY;

    // What the form sends for Online with Zoom preselected: the provider and
    // an empty link.
    const result = await createEvent(orgId, {
      title: "Exec sync",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3600_000).toISOString(),
      conferenceProvider: "ZOOM",
      conferenceUrl: "",
    });

    expect(result.error).toBeUndefined();
    expect(result.eventId).toBeTruthy();
    const eventId = result.eventId!;

    const row = await ownerDb.event.findFirstOrThrow({
      where: { id: eventId, organizationId: orgId },
      select: {
        conferenceProvider: true,
        conferenceUrl: true,
        conferenceManaged: true,
        conferenceSyncState: true,
        format: true,
      },
    });
    expect(row).toEqual({
      conferenceProvider: "ZOOM",
      conferenceUrl: null,
      conferenceManaged: false,
      conferenceSyncState: CalendarSyncState.PENDING,
      format: "ONLINE",
    });

    const jobs = await ownerDb.job.findMany({
      where: { organizationId: orgId, kind: "conference-sync" },
      select: { dedupeKey: true, status: true, payload: true },
    });
    expect(jobs).toEqual([
      { dedupeKey: `conference-sync:${eventId}`, status: "PENDING", payload: { eventId } },
    ]);
  });
});
