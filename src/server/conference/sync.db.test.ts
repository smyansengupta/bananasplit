// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The whole meeting chain against the real database: connecting a provider,
 * creating an event, and the conference-sync job turning that into a real
 * meeting with a join link on the row (docs/features/meetings.md).
 *
 * The provider itself is a fake that answers like the real one, which is the
 * point: everything between the save and the stored link - the job, the
 * secret, the token refresh, the compare-and-set, the failure states - is the
 * code that actually ships. Only the far side of the socket is pretend.
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
import { withSystemOrgTx, withOrgTx } from "@/server/db/context";
import { createEvent, updateEvent } from "@/server/events/service";
import { setSecret } from "@/server/secrets";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { conferenceHttp } from "./oauth";
import { conferenceSyncJob } from "./sync";
import { clearAllAccessTokens } from "./token";

const tag = randomBytes(4).toString("hex");
const orgId = `c_meet_${tag}`;
const DAY = 24 * 60 * 60 * 1000;

let adminId = "";
let reachable = true;

/** One run of the job, with the signal and deadline the runner would pass. */
function runJob(eventId: string, attempt = 1) {
  return conferenceSyncJob({
    id: `job_${randomBytes(4).toString("hex")}`,
    kind: "conference-sync",
    organizationId: orgId,
    payload: { eventId },
    dedupeKey: `conference-sync:${eventId}`,
    attempt,
    maxAttempts: 5,
    signal: AbortSignal.timeout(30_000),
    deadline: Date.now() + 30_000,
  });
}

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    ...(status === 204 ? {} : { headers: { "content-type": "application/json" } }),
  });
}

/**
 * A fake Zoom: the token endpoint, then the meeting endpoints. Returns the
 * requests it saw, so a test can assert what was actually sent.
 */
function fakeZoom(
  overrides: { createStatus?: number; createBody?: unknown; deleteStatus?: number } = {},
) {
  const seen: Array<{ url: string; method: string; body: unknown }> = [];
  vi.spyOn(conferenceHttp, "fetch").mockImplementation(async (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    let parsed: unknown = null;
    if (typeof init.body === "string") {
      try {
        parsed = JSON.parse(init.body);
      } catch {
        parsed = Object.fromEntries(new URLSearchParams(init.body));
      }
    }
    seen.push({ url, method, body: parsed });

    if (url.startsWith("https://zoom.us/oauth/token")) {
      return json({ access_token: `at_${randomBytes(3).toString("hex")}`, expires_in: 3600 });
    }
    if (url === "https://api.zoom.us/v2/users/me/meetings" && method === "POST") {
      if (overrides.createStatus) return json(overrides.createBody ?? { message: "no" }, overrides.createStatus);
      return json(
        overrides.createBody ?? {
          id: 98765432100,
          join_url: "https://us02web.zoom.us/j/98765432100",
          start_url: "https://us02web.zoom.us/s/98765432100?zak=secret",
          password: "pa55",
          settings: { global_dial_in_numbers: [{ country: "US", number: "+12025550111" }] },
        },
      );
    }
    if (url.startsWith("https://api.zoom.us/v2/meetings/")) {
      if (method === "PATCH") return json(null, 204);
      if (method === "DELETE") return json(null, overrides.deleteStatus ?? 204);
      return json({
        id: 98765432100,
        join_url: "https://us02web.zoom.us/j/98765432100",
        password: "pa55",
      });
    }
    throw new Error(`fake Zoom got an unexpected call: ${method} ${url}`);
  });
  return seen;
}

async function makeEvent(data: Record<string, unknown> = {}) {
  const row = await ownerDb.event.create({
    data: {
      organizationId: orgId,
      title: "Exec sync",
      startsAt: new Date(Date.now() + DAY),
      endsAt: new Date(Date.now() + DAY + 60 * 60 * 1000),
      createdById: adminId,
      format: "ONLINE",
      conferenceProvider: "ZOOM",
      conferenceSyncState: CalendarSyncState.PENDING,
      ...data,
    },
    select: { id: true },
  });
  return row.id;
}

function readEvent(id: string) {
  return ownerDb.event.findFirstOrThrow({
    where: { id, organizationId: orgId },
    select: {
      conferenceManaged: true,
      conferenceManagedAt: true,
      conferenceMeetingId: true,
      conferenceUrl: true,
      conferenceHostUrl: true,
      conferencePasscode: true,
      conferenceDialIn: true,
      conferenceSyncState: true,
      conferenceSyncError: true,
      syncVersion: true,
      updatedAt: true,
    },
  });
}

beforeAll(async () => {
  // The platform's OAuth client, which a real deployment sets in the
  // environment. The fake Zoom below is what it actually talks to.
  process.env.GOOGLE_MEET_CLIENT_ID = "test-meet-client";
  process.env.GOOGLE_MEET_CLIENT_SECRET = "test-meet-secret";
  process.env.ZOOM_CLIENT_ID = "test-zoom-client";
  process.env.ZOOM_CLIENT_SECRET = "test-zoom-secret";
  try {
    const user = await authDb.user.create({
      data: {
        email: `meet-admin-${tag}@example.edu`,
        name: "Meet Admin",
        emailVerified: new Date(),
        onboardedAt: new Date(),
      },
      select: { id: true },
    });
    adminId = user.id;
    // withOrgTx opens as the session user; these tests are that admin.
    session.requireUser.mockResolvedValue({ id: adminId, email: `meet-admin-${tag}@example.edu` });
    await ownerDb.organization.create({
      data: { id: orgId, name: "Meet Test Club", slug: `meet-club-${tag}`, timezone: "America/New_York" },
    });
    await ownerDb.membership.create({
      data: { organizationId: orgId, userId: adminId, role: "ADMIN" },
    });
    // Connect Zoom the way the OAuth callback does: an encrypted OrgSecret
    // plus a CONNECTED OrgIntegration row.
    await setSecret({
      orgId,
      actor: { userId: adminId, role: "ADMIN" },
      provider: "ZOOM",
      kind: "REFRESH_TOKEN",
      value: `rt_${randomBytes(8).toString("hex")}`,
      status: IntegrationStatus.CONNECTED,
      config: { accountEmail: "club@example.org", scopes: ["meeting:write:meeting"] },
    });
    await setSecret({
      orgId,
      actor: { userId: adminId, role: "ADMIN" },
      provider: "GOOGLE_MEET",
      kind: "REFRESH_TOKEN",
      value: `rt_meet_${randomBytes(8).toString("hex")}`,
      status: IntegrationStatus.CONNECTED,
      config: { accountEmail: "club@example.org" },
    });
  } catch (error) {
    reachable = false;
    // Loudly, so a broken setup never looks like a green run.
    console.warn(`[sync.db.test] database not reachable, skipping: ${String(error)}`);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllAccessTokens();
  // restoreAllMocks resets the session stub too, and withOrgTx needs it.
  if (adminId) session.requireUser.mockResolvedValue({ id: adminId });
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
  it("is actually talking to the database (or this whole file is a lie)", () => {
    expect(reachable, "the local database must be up for this file to mean anything").toBe(true);
    expect(adminId).not.toBe("");
  });
});

describe("creating the meeting", () => {
  it("stores the join link, the host link, the passcode and the dial-in", async () => {
    if (!reachable) return;
    const seen = fakeZoom();
    const eventId = await makeEvent();

    expect(await runJob(eventId)).toEqual({ status: "DONE" });

    const after = await readEvent(eventId);
    expect(after).toMatchObject({
      conferenceManaged: true,
      conferenceMeetingId: "98765432100",
      conferenceUrl: "https://us02web.zoom.us/j/98765432100",
      conferenceHostUrl: "https://us02web.zoom.us/s/98765432100?zak=secret",
      conferencePasscode: "pa55",
      conferenceSyncState: CalendarSyncState.SYNCED,
      conferenceSyncError: null,
    });
    expect(after.conferenceDialIn).toEqual([
      { country: "US", number: "+12025550111", pin: null },
    ]);

    // The token was fetched with the stored refresh token, then the meeting
    // was created in the connected account.
    expect(seen[0]!.url).toBe("https://zoom.us/oauth/token");
    expect((seen[0]!.body as Record<string, string>).grant_type).toBe("refresh_token");
    expect(seen[1]!.url).toBe("https://api.zoom.us/v2/users/me/meetings");
    expect(seen[1]!.body).toMatchObject({ topic: "Exec sync", type: 2 });
  });

  it("never touches a link someone pasted themselves", async () => {
    if (!reachable) return;
    const seen = fakeZoom();
    const eventId = await makeEvent({
      conferenceUrl: "https://us02web.zoom.us/j/manual",
      conferenceSyncState: CalendarSyncState.PENDING,
    });

    expect(await runJob(eventId)).toEqual({ status: "DONE" });

    const after = await readEvent(eventId);
    expect(after.conferenceUrl).toBe("https://us02web.zoom.us/j/manual");
    expect(after.conferenceManaged).toBe(false);
    expect(after.conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    // Nothing was asked of Zoom at all.
    expect(seen).toEqual([]);
  });

  it("does nothing for an in-person meeting", async () => {
    if (!reachable) return;
    const seen = fakeZoom();
    const eventId = await makeEvent({
      format: "IN_PERSON",
      conferenceProvider: "NONE",
      location: "Curry 342",
    });
    expect(await runJob(eventId)).toEqual({ status: "DONE" });
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(seen).toEqual([]);
  });
});

describe("moving and cancelling", () => {
  it("updates the meeting at Zoom when the event moves", async () => {
    if (!reachable) return;
    fakeZoom();
    const eventId = await makeEvent();
    await runJob(eventId);

    vi.restoreAllMocks();
    clearAllAccessTokens();
    const seen = fakeZoom();
    await ownerDb.event.update({
      where: { id: eventId },
      data: {
        startsAt: new Date(Date.now() + 3 * DAY),
        endsAt: new Date(Date.now() + 3 * DAY + 3600_000),
        conferenceSyncState: CalendarSyncState.PENDING,
        syncVersion: { increment: 1 },
      },
    });
    expect(await runJob(eventId)).toEqual({ status: "DONE" });

    const patch = seen.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe("https://api.zoom.us/v2/meetings/98765432100");
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.SYNCED);
  });

  it("cancels at Zoom and clears the link when the meeting goes in person", async () => {
    if (!reachable) return;
    fakeZoom();
    const eventId = await makeEvent();
    await runJob(eventId);

    vi.restoreAllMocks();
    clearAllAccessTokens();
    const seen = fakeZoom();
    await ownerDb.event.update({
      where: { id: eventId },
      data: {
        format: "IN_PERSON",
        conferenceSyncState: CalendarSyncState.PENDING,
        syncVersion: { increment: 1 },
      },
    });
    expect(await runJob(eventId)).toEqual({ status: "DONE" });

    expect(seen.some((r) => r.method === "DELETE")).toBe(true);
    expect(await readEvent(eventId)).toMatchObject({
      conferenceManaged: false,
      conferenceMeetingId: null,
      conferenceUrl: null,
      conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
    });
  });

  it("cancels at Zoom when the event is deleted", async () => {
    if (!reachable) return;
    fakeZoom();
    const eventId = await makeEvent();
    await runJob(eventId);

    vi.restoreAllMocks();
    clearAllAccessTokens();
    const seen = fakeZoom();
    await ownerDb.event.update({
      where: { id: eventId },
      data: { deletedAt: new Date(), syncVersion: { increment: 1 } },
    });
    expect(await runJob(eventId)).toEqual({ status: "DONE" });
    expect(seen.some((r) => r.method === "DELETE")).toBe(true);
    expect((await readEvent(eventId)).conferenceUrl).toBeNull();
  });

  it("treats a meeting Zoom has already lost as cancelled", async () => {
    if (!reachable) return;
    fakeZoom();
    const eventId = await makeEvent();
    await runJob(eventId);

    vi.restoreAllMocks();
    clearAllAccessTokens();
    fakeZoom({ deleteStatus: 404 });
    await ownerDb.event.update({
      where: { id: eventId },
      data: { format: "IN_PERSON", syncVersion: { increment: 1 } },
    });
    expect(await runJob(eventId)).toEqual({ status: "DONE" });
    expect((await readEvent(eventId)).conferenceUrl).toBeNull();
  });
});

describe("when things go wrong", () => {
  it("a save that lands mid-flight wins: the job does not overwrite it", async () => {
    if (!reachable) return;
    // The provider call is where the race happens, so the save goes in there.
    const eventId = await makeEvent();
    vi.spyOn(conferenceHttp, "fetch").mockImplementation(async (url) => {
      if (url.startsWith("https://zoom.us/oauth/token"))
        return json({ access_token: "at", expires_in: 3600 });
      await ownerDb.event.update({
        where: { id: eventId },
        data: { title: "Renamed while we were away", syncVersion: { increment: 1 } },
      });
      return json({ id: 1, join_url: "https://zoom.us/j/1" });
    });

    expect(await runJob(eventId)).toEqual({ status: "DONE" });

    const after = await readEvent(eventId);
    // The newer save is intact, and the row is still waiting for the job that
    // save queued rather than wearing a link made for the older title.
    expect(after.syncVersion).toBe(1);
    expect(after.conferenceUrl).toBeNull();
    expect(after.conferenceSyncState).toBe(CalendarSyncState.PENDING);
  });

  it("a 500 is retried and leaves the reason on the row", async () => {
    if (!reachable) return;
    fakeZoom({ createStatus: 500, createBody: { message: "Zoom is having a moment" } });
    const eventId = await makeEvent();

    await expect(runJob(eventId)).rejects.toThrow();

    const after = await readEvent(eventId);
    expect(after.conferenceSyncState).toBe(CalendarSyncState.FAILED);
    expect(after.conferenceSyncError).toMatch(/Zoom/);
    expect(after.conferenceUrl).toBeNull();
  });

  it("a refused grant marks the connection NEEDS_REAUTH and stops retrying", async () => {
    if (!reachable) return;
    vi.spyOn(conferenceHttp, "fetch").mockResolvedValue(
      json({ error: "invalid_grant", error_description: "gone" }, 400),
    );
    const eventId = await makeEvent();

    const outcome = await runJob(eventId);
    expect(outcome).toMatchObject({ status: "DEAD" });

    const integration = await ownerDb.orgIntegration.findFirstOrThrow({
      where: { organizationId: orgId, provider: "ZOOM" },
      select: { status: true, lastError: true },
    });
    expect(integration.status).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.FAILED);

    // Put it back for the tests that follow.
    await ownerDb.orgIntegration.updateMany({
      where: { organizationId: orgId, provider: "ZOOM" },
      data: { status: IntegrationStatus.CONNECTED, lastError: null },
    });
  });

  it("says so plainly when the provider is not connected at all", async () => {
    if (!reachable) return;
    const seen = fakeZoom();
    const eventId = await makeEvent({ conferenceProvider: "TEAMS" });

    const outcome = await runJob(eventId);
    expect(outcome).toMatchObject({ status: "DEAD" });
    expect(String((outcome as { error: string }).error)).toMatch(/not connected/i);
    const after = await readEvent(eventId);
    expect(after.conferenceSyncError).toMatch(/not connected/i);
    // It did not go near the network to find that out.
    expect(seen).toEqual([]);
  });

  it("an event deleted for good between the save and the job is not an error", async () => {
    if (!reachable) return;
    fakeZoom();
    expect(await runJob(`e_gone_${tag}`)).toEqual({ status: "DONE" });
  });
});

describe("the stored secret", () => {
  it("is never the plaintext token in the row, and never reaches the event", async () => {
    if (!reachable) return;
    fakeZoom();
    const eventId = await makeEvent();
    await runJob(eventId);

    const row = await ownerDb.orgSecret.findFirstOrThrow({
      where: { organizationId: orgId },
      select: { ciphertext: true, kind: true },
    });
    expect(row.kind).toBe("REFRESH_TOKEN");
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toMatch(/^rt_/);

    const after = await readEvent(eventId);
    expect(JSON.stringify(after)).not.toMatch(/rt_|at_/);
  });

  it("redacts a provider error that quotes a token back at us", async () => {
    if (!reachable) return;
    // Zoom's access tokens are JWTs and its errors do echo the request back,
    // so this is the shape that could really end up on a row an admin reads.
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOiJhYmMiLCJleHAiOjE5MDB9.c2lnbmF0dXJlLXZhbHVl";
    fakeZoom({
      createStatus: 400,
      createBody: {
        message: `Invalid access token ${jwt} for user host@club.example.org`,
      },
    });
    const eventId = await makeEvent();
    await runJob(eventId);

    const after = await readEvent(eventId);
    expect(after.conferenceSyncError).toBeTruthy();
    expect(after.conferenceSyncError).not.toContain(jwt);
    expect(after.conferenceSyncError).not.toContain("host@club.example.org");
    // Still says enough to act on.
    expect(after.conferenceSyncError).toMatch(/Zoom/);
  });
});

describe("the organization boundary", () => {
  it("a job for another org's event finds nothing", async () => {
    if (!reachable) return;
    const seen = fakeZoom();
    const otherOrgId = `c_meet_other_${tag}`;
    await ownerDb.organization.create({
      data: { id: otherOrgId, name: "Other", slug: `meet-other-${tag}`, timezone: "UTC" },
    });
    await ownerDb.membership.create({
      data: { organizationId: otherOrgId, userId: adminId, role: "ADMIN" },
    });
    const theirs = await ownerDb.event.create({
      data: {
        organizationId: otherOrgId,
        title: "Not ours",
        startsAt: new Date(Date.now() + DAY),
        endsAt: new Date(Date.now() + DAY + 3600_000),
        createdById: adminId,
        format: "ONLINE",
        conferenceProvider: "ZOOM",
      },
      select: { id: true },
    });

    // The job runs scoped to orgId, so the other org's event is invisible.
    expect(await runJob(theirs.id)).toEqual({ status: "DONE" });
    expect(seen).toEqual([]);
    expect(
      await withSystemOrgTx(otherOrgId, ({ db }) =>
        db.event.findFirstOrThrow({ where: { id: theirs.id }, select: { conferenceUrl: true } }),
      ),
    ).toEqual({ conferenceUrl: null });

    await ownerDb.organization.deleteMany({ where: { id: otherOrgId } });
  });
});

describe("the path a person actually takes", () => {
  /**
   * The two bugs this covers both made the whole feature a no-op in a way
   * nothing else caught: an event saved with a provider but no link was
   * rejected by validation ("Paste a meeting link"), and `format` was never
   * written, so every event stayed IN_PERSON and the sync job decided there
   * was nothing to do. Going through the real service is the only way to see
   * either of them.
   */
  async function createThroughService(input: Record<string, unknown>) {
    return withOrgTx(orgId, async (ctx) =>
      createEvent(
        { ...ctx, userId: adminId } as never,
        {
          title: "Exec sync",
          startsAt: new Date(Date.now() + DAY),
          endsAt: new Date(Date.now() + DAY + 3600_000),
          ...input,
        } as never,
      ),
    );
  }

  it("saves a Zoom meeting with no link pasted, and the job fills it in", async () => {
    if (!reachable) return;
    fakeZoom();

    const { event } = await createThroughService({ conferenceProvider: "ZOOM" });
    // It saved at all: an empty link against Zoom means "make it for me".
    expect(event.conferenceProvider).toBe("ZOOM");
    // And it is an online meeting, not the IN_PERSON default.
    expect(event.format).toBe("ONLINE");

    expect(await runJob(event.id)).toEqual({ status: "DONE" });
    const after = await readEvent(event.id);
    expect(after.conferenceUrl).toBe("https://us02web.zoom.us/j/98765432100");
    expect(after.conferenceManaged).toBe(true);
  });

  it("calls a meeting with a room and a link hybrid", async () => {
    if (!reachable) return;
    fakeZoom();
    const { event } = await createThroughService({
      conferenceProvider: "ZOOM",
      location: "Curry 342",
    });
    expect(event.format).toBe("HYBRID");
  });

  it("leaves a meeting with no provider in person", async () => {
    if (!reachable) return;
    const { event } = await createThroughService({ location: "Curry 342" });
    expect(event.format).toBe("IN_PERSON");
  });

  it("still insists on a link for a provider we cannot call", async () => {
    if (!reachable) return;
    await expect(createThroughService({ conferenceProvider: "OTHER" })).rejects.toThrow(
      /Paste a meeting link/,
    );
  });

  it("moves to in person when the provider is cleared, and cancels at Zoom", async () => {
    if (!reachable) return;
    fakeZoom();
    const { event } = await createThroughService({ conferenceProvider: "ZOOM" });
    await runJob(event.id);

    vi.restoreAllMocks();
    clearAllAccessTokens();
    const seen = fakeZoom();
    const updated = await withOrgTx(orgId, async (ctx) =>
      updateEvent({ ...ctx, userId: adminId } as never, event.id, {
        conferenceProvider: "NONE",
        location: "Curry 342",
      } as never),
    );
    expect(updated.event.format).toBe("IN_PERSON");

    expect(await runJob(event.id)).toEqual({ status: "DONE" });
    expect(seen.some((r) => r.method === "DELETE")).toBe(true);
    expect((await readEvent(event.id)).conferenceUrl).toBeNull();
  });
});

describe("switching provider", () => {
  it("cancels at the old one, then creates at the new one", async () => {
    if (!reachable) return;
    fakeZoom();
    const eventId = await makeEvent();
    await runJob(eventId);
    expect((await readEvent(eventId)).conferenceMeetingId).toBe("98765432100");

    // The person picks Google Meet instead. The want changes first; the Zoom
    // meeting is still out there and has to be called off.
    vi.restoreAllMocks();
    clearAllAccessTokens();
    const seen: Array<{ url: string; method: string }> = [];
    vi.spyOn(conferenceHttp, "fetch").mockImplementation(async (url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      seen.push({ url, method });
      if (url.includes("/oauth/token") || url.includes("oauth2.googleapis.com"))
        return json({ access_token: "at", expires_in: 3600 });
      if (url.startsWith("https://api.zoom.us/v2/meetings/")) return json(null, 204);
      if (url === "https://meet.googleapis.com/v2/spaces")
        return json({ name: "spaces/new1", meetingUri: "https://meet.google.com/new-abcd-efg" });
      throw new Error(`unexpected ${method} ${url}`);
    });
    await ownerDb.event.update({
      where: { id: eventId },
      data: {
        conferenceProvider: "MEET",
        conferenceSyncState: CalendarSyncState.PENDING,
        syncVersion: { increment: 1 },
      },
    });

    // First run cancels at Zoom and leaves the row waiting.
    expect(await runJob(eventId)).toEqual({ status: "DONE" });
    expect(seen.some((r) => r.method === "DELETE" && r.url.includes("api.zoom.us"))).toBe(true);
    const between = await readEvent(eventId);
    expect(between.conferenceManaged).toBe(false);
    expect(between.conferenceSyncState).toBe(CalendarSyncState.PENDING);

    // The follow-up run creates at Google.
    expect(await runJob(eventId)).toEqual({ status: "DONE" });
    const after = await readEvent(eventId);
    expect(after.conferenceUrl).toBe("https://meet.google.com/new-abcd-efg");
    expect(after.conferenceMeetingId).toBe("spaces/new1");
    expect(after.conferenceSyncState).toBe(CalendarSyncState.SYNCED);
  });
});
