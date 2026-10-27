// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The OAuth callback end to end against the real database
 * (docs/features/meetings.md): completeConferenceConnect with a signed state
 * and cookie, a fake provider answering the code exchange, and the real
 * setSecret and requeueWaitingMeetings behind it.
 *
 * requeue.db.test.ts covers the requeue on its own; this file pins the wiring
 * between the two, which no function test can: a meeting saved before its
 * provider was connected gets its link as soon as someone connects, a failed
 * requeue never turns a stored connection into an error, and a grant we
 * refuse queues nothing.
 *
 * No test here puts a token in an assertion or a log line.
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
// The real requeue, unless a case makes it throw once.
vi.mock("./requeue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./requeue")>();
  return { ...actual, requeueWaitingMeetings: vi.fn(actual.requeueWaitingMeetings) };
});

import { CalendarSyncState, IntegrationStatus } from "@/generated/prisma/enums";
import { authDb, disconnectAll } from "@/server/db/clients";
import { getSecret } from "@/server/secrets";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { completeConferenceConnect, providerFromSlug } from "./connect";
import { conferenceHttp, pkcePair, signCookie, signState, STATE_TTL_MS } from "./oauth";
import { requeueWaitingMeetings } from "./requeue";

const tag = randomBytes(4).toString("hex");
const orgId = `c_cn_${tag}`;
const DAY = 24 * 60 * 60 * 1000;
const ZOOM = providerFromSlug("zoom")!;

let ownerId = "";
let reachable = true;
/** Whether a database answered at all, as opposed to the fixture failing. */
let databaseUp = false;

/** The token the fake Zoom hands out. Compared, never printed. */
let issuedRefreshToken = "";

/** The spies a case installed, put back after it. */
const spies: Array<{ mockRestore: () => void }> = [];

/** Which scopes the fake Zoom says it granted. */
const GRANTED_ALL =
  "meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user";
const GRANTED_SHORT = "user:read:user";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fake Zoom's token and revoke endpoints. Returns the URLs it was asked
 * for, so a case can say which calls were made without reading any body.
 */
function fakeZoom(scope: string) {
  const urls: string[] = [];
  const spy = vi.spyOn(conferenceHttp, "fetch").mockImplementation(async (url) => {
    urls.push(url);
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return json({
        access_token: `at_${randomBytes(6).toString("hex")}`,
        refresh_token: issuedRefreshToken,
        scope,
        expires_in: 3600,
      });
    }
    if (url.startsWith("https://zoom.us/oauth/revoke")) return json({ status: "success" });
    throw new Error(`fake Zoom got an unexpected call: ${url}`);
  });
  spies.push(spy);
  return urls;
}

/** What /start would have set: the signed state, and the cookie to match. */
function signedFlow() {
  const nonce = randomBytes(18).toString("base64url");
  const { verifier } = pkcePair();
  return {
    state: signState({
      provider: "ZOOM",
      orgId,
      userId: ownerId,
      nonce,
      exp: Date.now() + STATE_TTL_MS,
    }),
    cookie: signCookie({ provider: "ZOOM", nonce, verifier, orgId }),
  };
}

function connectZoom() {
  const { state, cookie } = signedFlow();
  return completeConferenceConnect({
    provider: ZOOM,
    state,
    code: "an-authorization-code",
    error: null,
    cookie,
    sessionUserId: ownerId,
  });
}

/** An online Zoom meeting that was saved before Zoom was connected. */
async function makeWaitingEvent() {
  const row = await ownerDb.event.create({
    data: {
      organizationId: orgId,
      title: "Exec sync",
      startsAt: new Date(Date.now() + DAY),
      endsAt: new Date(Date.now() + DAY + 60 * 60 * 1000),
      createdById: ownerId,
      format: "ONLINE",
      conferenceProvider: "ZOOM",
      conferenceUrl: null,
      conferenceManaged: false,
      conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
    },
    select: { id: true },
  });
  return row.id;
}

function readEvent(id: string) {
  return ownerDb.event.findFirstOrThrow({
    where: { id },
    select: { conferenceSyncState: true },
  });
}

function conferenceJobs(eventId?: string) {
  return ownerDb.job.findMany({
    where: {
      organizationId: orgId,
      kind: "conference-sync",
      ...(eventId ? { dedupeKey: `conference-sync:${eventId}` } : {}),
    },
    select: { dedupeKey: true, status: true, payload: true },
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

  // The platform's OAuth client and the signing secret, as a deployment sets
  // them. The fake Zoom above is what the client actually talks to.
  process.env.ZOOM_CLIENT_ID = "test-zoom-client";
  process.env.ZOOM_CLIENT_SECRET = "test-zoom-secret";
  process.env.AUTH_SECRET ||= randomBytes(16).toString("hex");
  try {
    const user = await authDb.user.create({
      data: {
        email: `connect-owner-${tag}@example.edu`,
        name: "Connect Owner",
        emailVerified: new Date(),
        onboardedAt: new Date(),
      },
      select: { id: true },
    });
    ownerId = user.id;
    // withOrgTx opens as the session user: these tests are that owner.
    session.requireUser.mockResolvedValue({
      id: ownerId,
      email: `connect-owner-${tag}@example.edu`,
    });
    await ownerDb.organization.create({
      data: {
        id: orgId,
        name: "Connect Test Club",
        slug: `cn-club-${tag}`,
        timezone: "America/New_York",
      },
    });
    await ownerDb.membership.create({
      data: { organizationId: orgId, userId: ownerId, role: "OWNER" },
    });
  } catch (error) {
    reachable = false;
    // Loudly, so a broken setup never looks like a green run.
    console.warn(`[connect.db.test] database not reachable, skipping: ${String(error)}`);
  }
});

beforeEach(() => {
  issuedRefreshToken = `rt_${randomBytes(12).toString("hex")}`;
});

afterEach(async () => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  if (!reachable) return;
  // Each case starts from an org with no meetings, jobs or connection.
  await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.event.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.orgSecret.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.orgIntegration.deleteMany({ where: { organizationId: orgId } });
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
    await ownerDb.organization.deleteMany({ where: { id: orgId } });
    await ownerDb.user.deleteMany({ where: { id: ownerId } });
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
    expect(ownerId).not.toBe("");
  });
});

describe("completing a connect", () => {
  it("a successful connect requeues the meetings waiting for that provider", async () => {
    if (!reachable) return;
    const urls = fakeZoom(GRANTED_ALL);
    const eventId = await makeWaitingEvent();

    const outcome = await connectZoom();

    expect(outcome).toEqual({ ok: true, orgSlug: `cn-club-${tag}` });
    // The code was exchanged at Zoom, and nothing was revoked.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^https:\/\/zoom\.us\/oauth\/token/);

    // The connection is stored: CONNECTED, with the refresh token Zoom issued.
    const integration = await ownerDb.orgIntegration.findFirstOrThrow({
      where: { organizationId: orgId, provider: "ZOOM" },
      select: { status: true },
    });
    expect(integration.status).toBe(IntegrationStatus.CONNECTED);
    const stored = await getSecret({ orgId, provider: "ZOOM", kind: "REFRESH_TOKEN" });
    expect(stored === issuedRefreshToken).toBe(true);

    // And the meeting that was waiting for it is queued.
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.PENDING);
    const jobs = await conferenceJobs(eventId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      dedupeKey: `conference-sync:${eventId}`,
      status: "PENDING",
      payload: { eventId },
    });
  });

  it("a failed requeue does not fail the connect", async () => {
    if (!reachable) return;
    fakeZoom(GRANTED_ALL);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    spies.push(warn);
    vi.mocked(requeueWaitingMeetings).mockRejectedValueOnce(new Error("the database went away"));
    const eventId = await makeWaitingEvent();

    const outcome = await connectZoom();

    // The connection was already stored, so it is still a good connect.
    expect(outcome).toEqual({ ok: true, orgSlug: `cn-club-${tag}` });
    const integration = await ownerDb.orgIntegration.findFirstOrThrow({
      where: { organizationId: orgId, provider: "ZOOM" },
      select: { status: true },
    });
    expect(integration.status).toBe(IntegrationStatus.CONNECTED);
    const stored = await getSecret({ orgId, provider: "ZOOM", kind: "REFRESH_TOKEN" });
    expect(stored === issuedRefreshToken).toBe(true);

    // Said plainly in the log, with the reason.
    const warned = warn.mock.calls.map(([message]) => String(message));
    expect(warned.some((m) => m.startsWith("[conference] requeue after connect failed:"))).toBe(
      true,
    );

    // The throw happened before anything was queued: the meeting still waits.
    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await conferenceJobs()).toHaveLength(0);
  });

  it("a refused grant requeues nothing", async () => {
    if (!reachable) return;
    // Zoom grants less than the meeting scope we insist on.
    const urls = fakeZoom(GRANTED_SHORT);
    const eventId = await makeWaitingEvent();

    const outcome = await connectZoom();

    expect(outcome).toMatchObject({ ok: false, code: "scopes" });
    // The half-working grant was revoked again rather than stored.
    expect(urls.some((u) => u.startsWith("https://zoom.us/oauth/revoke"))).toBe(true);
    expect(
      await ownerDb.orgIntegration.count({ where: { organizationId: orgId, provider: "ZOOM" } }),
    ).toBe(0);

    expect((await readEvent(eventId)).conferenceSyncState).toBe(CalendarSyncState.NOT_APPLICABLE);
    expect(await conferenceJobs()).toHaveLength(0);
  });
});
