// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Disconnecting a meeting provider against the real database
 * (docs/features/meetings.md): the revoke at the provider, the status, the
 * audit row, and who may delete the stored token, with the real setSecret,
 * getSecret and removeSecret behind it. Only the far side of the socket is a
 * fake.
 *
 * No test here puts a token in an assertion or a log line: tokens are
 * compared with ===, never printed.
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
import { ForbiddenError } from "@/lib/auth/errors";
import { disconnectMeetingProviderAction } from "@/app/app/[orgSlug]/meetings/actions";
import { authDb, disconnectAll } from "@/server/db/clients";
import { getSecret, removeSecret, setSecret } from "@/server/secrets";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { disconnectMeetingProvider } from "./disconnect";
import { conferenceHttp } from "./oauth";
import { clearAllAccessTokens, getAccessToken } from "./token";

const tag = randomBytes(4).toString("hex");
const orgId = `c_dis_${tag}`;
const DAY = 24 * 60 * 60 * 1000;

let ownerId = "";
let adminId = "";
let memberId = "";
let reachable = true;
/** Whether a database answered at all, as opposed to the fixture failing. */
let databaseUp = false;

/** The refresh token the current case connected. Compared, never printed. */
let storedToken = "";

const owner = () => ({ userId: ownerId, role: "OWNER" as const });
const admin = () => ({ userId: adminId, role: "ADMIN" as const });
const member = () => ({ userId: memberId, role: "MEMBER" as const });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fake provider's revoke and token endpoints. Returns what it was asked,
 * so a case can say which calls were made, and with which token, without
 * ever reading a token aloud.
 */
function fakeProvider(options: { revokeStatus?: number } = {}) {
  const seen: Array<{ url: string; token: string | null }> = [];
  vi.spyOn(conferenceHttp, "fetch").mockImplementation(async (url, init) => {
    const body = typeof init.body === "string" ? new URLSearchParams(init.body) : null;
    seen.push({ url, token: body?.get("token") ?? null });
    if (url.endsWith("/oauth/revoke") || url.endsWith("/revoke")) {
      const status = options.revokeStatus ?? 200;
      return status === 200 ? json({ status: "success" }) : json({ error: "server_error" }, status);
    }
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return json({ access_token: `at_${randomBytes(4).toString("hex")}`, expires_in: 3600 });
    }
    throw new Error(`fake provider got an unexpected call: ${url}`);
  });
  return seen;
}

/** The org's Zoom connection, as the OAuth callback leaves it. */
async function connect(provider: "ZOOM" | "GOOGLE_MEET" | "MICROSOFT_TEAMS" = "ZOOM") {
  const value = `rt_${randomBytes(12).toString("hex")}`;
  await setSecret({
    orgId,
    actor: owner(),
    provider,
    kind: "REFRESH_TOKEN",
    value,
    status: IntegrationStatus.CONNECTED,
    config: { accountEmail: "club@example.org", scopes: ["meeting:write:meeting"] },
  });
  return value;
}

function readIntegration(
  provider: "ZOOM" | "GOOGLE_MEET" | "MICROSOFT_TEAMS" | "GOOGLE_CALENDAR" = "ZOOM",
) {
  return ownerDb.orgIntegration.findFirstOrThrow({
    where: { organizationId: orgId, provider },
    select: { id: true, status: true, config: true },
  });
}

function disconnectedAudit() {
  return ownerDb.orgAuditLog.findMany({
    where: { organizationId: orgId, action: "integration.disconnected" },
    select: { actorId: true, targetType: true, diffJson: true },
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

  // The platform's OAuth clients, as a deployment sets them. The fake
  // provider above is what they actually talk to.
  process.env.ZOOM_CLIENT_ID = "test-zoom-client";
  process.env.ZOOM_CLIENT_SECRET = "test-zoom-secret";
  process.env.GOOGLE_MEET_CLIENT_ID = "test-meet-client";
  process.env.GOOGLE_MEET_CLIENT_SECRET = "test-meet-secret";
  process.env.MICROSOFT_TEAMS_CLIENT_ID = "test-teams-client";
  process.env.MICROSOFT_TEAMS_CLIENT_SECRET = "test-teams-secret";
  try {
    const make = async (role: string) =>
      (
        await authDb.user.create({
          data: {
            email: `disconnect-${role}-${tag}@example.edu`,
            name: `Disconnect ${role}`,
            emailVerified: new Date(),
            onboardedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
    ownerId = await make("owner");
    adminId = await make("admin");
    memberId = await make("member");
    await ownerDb.organization.create({
      data: {
        id: orgId,
        name: "Disconnect Test Club",
        slug: `dis-club-${tag}`,
        timezone: "America/New_York",
      },
    });
    for (const [userId, role] of [
      [ownerId, "OWNER"],
      [adminId, "ADMIN"],
      [memberId, "MEMBER"],
    ] as const) {
      await ownerDb.membership.create({ data: { organizationId: orgId, userId, role } });
    }
  } catch (error) {
    reachable = false;
    // Loudly, so a broken setup never looks like a green run.
    console.warn(`[disconnect.db.test] database not reachable, skipping: ${String(error)}`);
  }
});

beforeEach(async () => {
  if (!reachable) return;
  // Every case starts with Zoom connected, the common state to leave.
  storedToken = await connect("ZOOM");
});

afterEach(async () => {
  vi.restoreAllMocks();
  clearAllAccessTokens();
  if (!reachable) return;
  // Each case starts from an org with no meetings, jobs or connections.
  await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.event.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.orgSecret.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.orgIntegration.deleteMany({ where: { organizationId: orgId } });
  await ownerDb.orgAuditLog.deleteMany({ where: { organizationId: orgId } });
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: orgId } });
    await ownerDb.organization.deleteMany({ where: { id: orgId } });
    await ownerDb.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId] } } });
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

describe("disconnecting a meeting provider", () => {
  it("an owner disconnects: revoked at the provider, token deleted", async () => {
    if (!reachable) return;
    const seen = fakeProvider();

    const result = await disconnectMeetingProvider(orgId, owner(), "ZOOM");

    expect(result).toEqual({
      ok: true,
      message: "Disconnected. Access was revoked at Zoom and the token deleted.",
    });
    // The grant was revoked at Zoom, with the token we held.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://zoom.us/oauth/revoke");
    expect(seen[0]!.token === storedToken).toBe(true);

    const row = await readIntegration();
    expect(row.status).toBe(IntegrationStatus.DISCONNECTED);
    const config = row.config as { accountEmail?: string; disconnectedAt?: string };
    expect(config.accountEmail).toBe("club@example.org");
    expect(Number.isNaN(Date.parse(config.disconnectedAt ?? ""))).toBe(false);
    expect(await getSecret({ orgId, provider: "ZOOM", kind: "REFRESH_TOKEN" })).toBeNull();

    // One audit row, by the actor, naming the provider and never a token.
    const audit = await disconnectedAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: ownerId,
      targetType: "OrgIntegration",
      diffJson: { provider: "ZOOM", revokedInline: true },
    });
    expect(JSON.stringify(audit)).not.toContain(storedToken);
  });

  it("an admin disconnects: token kept until an owner removes it", async () => {
    if (!reachable) return;
    const seen = fakeProvider();

    const result = await disconnectMeetingProvider(orgId, admin(), "ZOOM");

    expect(result).toEqual({ ok: true, message: "Disconnected. Access was revoked at Zoom." });
    expect(seen.map((s) => s.url)).toEqual(["https://zoom.us/oauth/revoke"]);
    expect((await readIntegration()).status).toBe(IntegrationStatus.DISCONNECTED);
    // Revoked, so useless, but an admin may not delete it: it stays encrypted.
    const kept = await getSecret({ orgId, provider: "ZOOM", kind: "REFRESH_TOKEN" });
    expect(kept === storedToken).toBe(true);
    expect(await disconnectedAudit()).toHaveLength(1);
  });

  it("a revoke that fails still disconnects", async () => {
    if (!reachable) return;
    const seen = fakeProvider({ revokeStatus: 500 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Even an owner keeps the token: it was not revoked, so deleting it would
    // leave a live grant at Zoom that nobody here can ever revoke.
    const result = await disconnectMeetingProvider(orgId, owner(), "ZOOM");

    expect(result).toEqual({
      ok: true,
      message:
        "Disconnected. Remove Bananasplit from that Zoom account's connected apps to finish.",
    });
    expect(seen).toHaveLength(1);
    expect((await readIntegration()).status).toBe(IntegrationStatus.DISCONNECTED);
    const kept = await getSecret({ orgId, provider: "ZOOM", kind: "REFRESH_TOKEN" });
    expect(kept === storedToken).toBe(true);

    const audit = await disconnectedAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ diffJson: { provider: "ZOOM", revokedInline: false } });
    // The failure is logged, and the log never carries the token.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain(storedToken);
  });

  it("members cannot disconnect", async () => {
    if (!reachable) return;
    const seen = fakeProvider();

    await expect(disconnectMeetingProvider(orgId, member(), "ZOOM")).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Nothing happened: no call to the provider, still connected, no audit.
    expect(seen).toHaveLength(0);
    expect((await readIntegration()).status).toBe(IntegrationStatus.CONNECTED);
    expect(await disconnectedAudit()).toHaveLength(0);
  });

  it("not connected", async () => {
    if (!reachable) return;
    await ownerDb.orgSecret.deleteMany({ where: { organizationId: orgId } });
    await ownerDb.orgIntegration.deleteMany({ where: { organizationId: orgId } });
    const seen = fakeProvider();
    // The revoke finds no token to send and says so in the log.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await disconnectMeetingProvider(orgId, owner(), "ZOOM");

    expect(result).toEqual({ ok: false, error: "Zoom is not connected." });
    expect(seen).toHaveLength(0);
    expect(await disconnectedAudit()).toHaveLength(0);
  });

  it("only a meeting provider can be disconnected here", async () => {
    if (!reachable) return;
    const seen = fakeProvider();

    const result = await disconnectMeetingProvider(orgId, owner(), "GOOGLE_CALENDAR");

    expect(result).toMatchObject({ ok: false });
    expect(seen).toHaveLength(0);
    expect(await disconnectedAudit()).toHaveLength(0);
  });

  it("existing meetings keep their links", async () => {
    if (!reachable) return;
    fakeProvider();
    const event = await ownerDb.event.create({
      data: {
        organizationId: orgId,
        title: "Exec sync",
        startsAt: new Date(Date.now() + DAY),
        endsAt: new Date(Date.now() + DAY + 60 * 60 * 1000),
        createdById: ownerId,
        format: "ONLINE",
        conferenceProvider: "ZOOM",
        conferenceManaged: true,
        conferenceManagedAt: "ZOOM",
        conferenceMeetingId: "98765432100",
        conferenceUrl: "https://us02web.zoom.us/j/98765432100",
        conferenceHostUrl: "https://us02web.zoom.us/s/98765432100",
        conferenceSyncState: CalendarSyncState.SYNCED,
      },
      select: { id: true },
    });
    const read = () => ownerDb.event.findFirstOrThrow({ where: { id: event.id } });
    const before = await read();

    await disconnectMeetingProvider(orgId, owner(), "ZOOM");

    // The row is untouched, down to its timestamps: no resync, no job.
    expect(await read()).toEqual(before);
    expect(await ownerDb.job.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("a provider with no revoke endpoint says what is left to do", async () => {
    if (!reachable) return;
    const teamsToken = await connect("MICROSOFT_TEAMS");
    const seen = fakeProvider();

    const result = await disconnectMeetingProvider(orgId, owner(), "MICROSOFT_TEAMS");

    // Microsoft offers no revoke call, so there is nothing to ask and nothing
    // that can fail: the token is ours to delete. But nothing was revoked, and
    // the message must not say it was.
    expect(result).toEqual({
      ok: true,
      message:
        "Disconnected and the token deleted. Remove Bananasplit from that Microsoft Teams account's connected apps to revoke its access too.",
    });
    expect(seen).toHaveLength(0);
    expect((await readIntegration("MICROSOFT_TEAMS")).status).toBe(IntegrationStatus.DISCONNECTED);
    expect(
      await getSecret({ orgId, provider: "MICROSOFT_TEAMS", kind: "REFRESH_TOKEN" }),
    ).toBeNull();
    // Zoom, next to it, is not touched.
    expect((await readIntegration("ZOOM")).status).toBe(IntegrationStatus.CONNECTED);
    expect(teamsToken).not.toBe(storedToken);
  });

  it("a provider with no revoke endpoint, disconnected by an admin, keeps the token and says what is left", async () => {
    if (!reachable) return;
    const teamsToken = await connect("MICROSOFT_TEAMS");
    const seen = fakeProvider();

    const result = await disconnectMeetingProvider(orgId, admin(), "MICROSOFT_TEAMS");

    expect(result).toEqual({
      ok: true,
      message:
        "Disconnected. Remove Bananasplit from that Microsoft Teams account's connected apps to revoke its access too.",
    });
    expect(seen).toHaveLength(0);
    expect((await readIntegration("MICROSOFT_TEAMS")).status).toBe(IntegrationStatus.DISCONNECTED);
    const kept = await getSecret({ orgId, provider: "MICROSOFT_TEAMS", kind: "REFRESH_TOKEN" });
    expect(kept === teamsToken).toBe(true);
  });

  it("a provider with a revoke endpoint says it was revoked, in its own name", async () => {
    if (!reachable) return;
    const meetToken = await connect("GOOGLE_MEET");
    const seen = fakeProvider();

    const result = await disconnectMeetingProvider(orgId, owner(), "GOOGLE_MEET");

    expect(result).toEqual({
      ok: true,
      message: "Disconnected. Access was revoked at Google Meet and the token deleted.",
    });
    expect(seen.map((s) => s.url)).toEqual(["https://oauth2.googleapis.com/revoke"]);
    expect(seen[0]!.token === meetToken).toBe(true);
  });

  it("forgets the cached access token, so a kept token is not used on", async () => {
    if (!reachable) return;
    const seen = fakeProvider();
    const tokenCalls = () => seen.filter((s) => s.url.startsWith("https://zoom.us/oauth/token"));

    await getAccessToken(orgId, "ZOOM");
    await getAccessToken(orgId, "ZOOM");
    expect(tokenCalls()).toHaveLength(1); // the second came from the cache

    // An admin leaves the (revoked) refresh token stored, which is exactly
    // the case where only clearing the cache stops the access token living on.
    await disconnectMeetingProvider(orgId, admin(), "ZOOM");

    await getAccessToken(orgId, "ZOOM");
    expect(tokenCalls()).toHaveLength(2);
  });
});

describe("the disconnect action", () => {
  /** Signs in as one of the org's people: withOrgTx opens as the session user. */
  function signInAs(userId: string) {
    session.requireUser.mockResolvedValue({ id: userId, email: `${userId}@example.edu` });
  }

  it("disconnects as the signed-in owner, and says what happened", async () => {
    if (!reachable) return;
    fakeProvider();
    signInAs(ownerId);

    const result = await disconnectMeetingProviderAction(orgId, "ZOOM");

    expect(result).toEqual({
      ok: true,
      message: "Disconnected. Access was revoked at Zoom and the token deleted.",
    });
    expect((await readIntegration()).status).toBe(IntegrationStatus.DISCONNECTED);
  });

  it("refuses a provider that is not a meeting provider", async () => {
    if (!reachable) return;
    const seen = fakeProvider();
    // Google Calendar has its own disconnect, with a revoke job behind it;
    // this action must not be a way round that.
    await setSecret({
      orgId,
      actor: owner(),
      provider: "GOOGLE_CALENDAR",
      kind: "REFRESH_TOKEN",
      value: `rt_${randomBytes(12).toString("hex")}`,
      status: IntegrationStatus.CONNECTED,
    });
    signInAs(ownerId);

    for (const provider of ["GOOGLE_CALENDAR", "CLAUDE", "NOT_A_PROVIDER", ""]) {
      expect(await disconnectMeetingProviderAction(orgId, provider)).toEqual({
        ok: false,
        message: "Invalid input.",
      });
    }

    expect(seen).toHaveLength(0);
    expect((await readIntegration("GOOGLE_CALENDAR")).status).toBe(IntegrationStatus.CONNECTED);
    expect((await readIntegration("ZOOM")).status).toBe(IntegrationStatus.CONNECTED);
    expect(await disconnectedAudit()).toHaveLength(0);
  });

  it("tells a member no, and a stranger nothing", async () => {
    if (!reachable) return;
    const seen = fakeProvider();

    signInAs(memberId);
    expect(await disconnectMeetingProviderAction(orgId, "ZOOM")).toEqual({
      ok: false,
      message: "You don't have permission to do that.",
    });

    signInAs(ownerId);
    expect(await disconnectMeetingProviderAction(`not_${orgId}`, "ZOOM")).toEqual({
      ok: false,
      message: "Not found.",
    });

    expect(seen).toHaveLength(0);
    expect((await readIntegration()).status).toBe(IntegrationStatus.CONNECTED);
  });
});

describe("removing a secret while a refresh rotates it", () => {
  // Disconnect calls removeSecret while a conference-sync job may be keeping a
  // rotated refresh token. rotateSecret locks the OrgIntegration row, then
  // writes the OrgSecret row; removeSecret used to lock them the other way
  // round, which is a deadlock waiting for the right two requests.
  it("waits for the rotation instead of deadlocking with it", async () => {
    if (!reachable) return;
    const integration = await readIntegration();

    let holderXid = "";
    let lockTaken!: () => void;
    const locked = new Promise<void>((resolve) => (lockTaken = resolve));
    let release!: () => void;
    const mayWrite = new Promise<void>((resolve) => (release = resolve));

    // What rotateSecret does: the integration row first, then the secret row.
    const rotation = ownerDb.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "OrgIntegration" WHERE "id" = ${integration.id} FOR UPDATE`;
        const rows = await tx.$queryRaw<{ xid: string }[]>`
          SELECT (txid_current() & 4294967295)::text AS xid`;
        holderXid = rows[0]!.xid;
        lockTaken();
        await mayWrite;
        await tx.$executeRaw`
          UPDATE "OrgSecret" SET "createdAt" = now() WHERE "integrationId" = ${integration.id}`;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    void rotation.catch(() => undefined);
    await locked;

    const removal = removeSecret({
      orgId,
      actor: owner(),
      provider: "ZOOM",
      kind: "REFRESH_TOKEN",
    });
    void removal.catch(() => undefined);

    // Wait until the removal is queued behind the rotation's row lock...
    await vi.waitFor(
      async () => {
        const rows = await ownerDb.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_locks
           WHERE locktype = 'transactionid' AND NOT granted AND transactionid::text = ${holderXid}`;
        expect(rows[0]!.waiting).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 25 },
    );
    // ...then let the rotation write its secret row. Locked the other way
    // round, the two now wait on each other and Postgres cancels one.
    release();

    await expect(Promise.all([rotation, removal])).resolves.toEqual([undefined, true]);
    expect(await getSecret({ orgId, provider: "ZOOM", kind: "REFRESH_TOKEN" })).toBeNull();
  });
});
