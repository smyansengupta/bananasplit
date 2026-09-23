// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test of the platform services against the real roles and
 * policies on the local database (the DATABASE_URL_* URLs in .env) with the
 * seeded Claude Builders Club: the outbox (enqueue in the caller's
 * transaction, drain, notify-email with the emailSentAt compare-and-set),
 * secrets through the accessor, the Postgres rate limiter, the event
 * service, members and /api/health. Skipped when the database or the seed
 * is not there (CI's unit job has no database).
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

process.env.EMAIL_DELIVERY = "sink";

import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

import { authDb, disconnectAll, legacyDb } from "./db/clients";
import { withOrgAction, withOrgTx, withSystemOrgTx } from "./db/context";
import { createEvent } from "./events/service";
import { runHealthChecks } from "./health";
import { drainJobs } from "./jobs/drain";
import { enqueueJob } from "./jobs/enqueue";
import { getOrgMembersForPicker } from "./members";
import { notifyUsers } from "./notifications";
import { getSecret, removeSecret, setSecret } from "./secrets";

interface Person {
  id: string;
  email: string;
  name: string | null;
}
interface Seeded {
  cbcId: string;
  jackson: Person;
  kristine: Person;
}

let seeded: Seeded | null = null;
try {
  const [cbc, jackson, kristine] = await Promise.all([
    legacyDb.organization.findUnique({ where: { slug: "claude-builders-club" }, select: { id: true } }),
    authDb.user.findUnique({ where: { email: "jackson@example.edu" }, select: { id: true, email: true, name: true } }),
    authDb.user.findUnique({ where: { email: "kristine@example.edu" }, select: { id: true, email: true, name: true } }),
  ]);
  if (cbc && jackson && kristine) seeded = { cbcId: cbc.id, jackson, kristine };
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("platform services against the local database (seeded CBC)", () => {
  const s = seeded as Seeded;
  const createdEvents: string[] = [];
  const createdNotifications: string[] = [];

  beforeAll(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  beforeEach(() => {
    requireUserMock.mockResolvedValue(s.jackson);
  });
  afterAll(async () => {
    await withSystemOrgTx(s.cbcId, async ({ db }) => {
      if (createdEvents.length) await db.event.deleteMany({ where: { id: { in: createdEvents } } });
      if (createdNotifications.length) {
        await db.notification.deleteMany({ where: { id: { in: createdNotifications } } });
      }
    });
    await disconnectAll();
  });

  it("health: every runtime role and the security manifest pass", async () => {
    const report = await runHealthChecks();
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("outbox: a notification's email job commits with it, runs once, and marks emailSentAt", async () => {
    const [id] = await withOrgAction(async (ctx) =>
      notifyUsers(ctx.db, ctx.organizationId, [s.kristine.id], {
        type: "TASK_ASSIGNED",
        title: "Integration test assignment",
        linkUrl: "/app/claude-builders-club/tasks",
      }),
    )(s.cbcId);
    createdNotifications.push(id!);

    const jobs = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.job.findMany({ where: { dedupeKey: `notify-email:${id}` }, select: { status: true } }),
    );
    expect(jobs).toEqual([{ status: "PENDING" }]);

    const summary = await drainJobs({ kinds: ["notify-email"], budgetMs: 60_000 });
    expect(summary.refused).toBeUndefined();
    const after = await withSystemOrgTx(s.cbcId, async ({ db }) => ({
      n: await db.notification.findUnique({ where: { id }, select: { emailSentAt: true } }),
      job: await db.job.findFirst({ where: { dedupeKey: `notify-email:${id}` }, select: { status: true } }),
    }));
    expect(after.n?.emailSentAt).toBeInstanceOf(Date);
    expect(after.job?.status).toBe("DONE");
  });

  it("outbox: a rolled-back action leaves no notification and no job", async () => {
    let id: string | undefined;
    const failing = withOrgAction(async (ctx) => {
      [id] = await notifyUsers(ctx.db, ctx.organizationId, [s.kristine.id], {
        type: "TASK_ASSIGNED",
        title: "Rolled back",
      });
      throw new Error("boom");
    });
    await expect(failing(s.cbcId)).rejects.toThrow("boom");
    const left = await withSystemOrgTx(s.cbcId, async ({ db }) => ({
      n: await db.notification.count({ where: { id } }),
      j: await db.job.count({ where: { dedupeKey: `notify-email:${id}` } }),
    }));
    expect(left).toEqual({ n: 0, j: 0 });
  });

  it("outbox: a member can enqueue only for their own org", async () => {
    requireUserMock.mockResolvedValue(s.kristine);
    const other = await legacyDb.organization.findFirst({
      where: { slug: "robotics-club" },
      select: { id: true },
    });
    const attempt = withOrgAction(async (ctx) =>
      enqueueJob(ctx.db, {
        orgId: other!.id,
        kind: "gcal",
        key: "evt_x",
        payload: { eventId: "evt_x" },
        noKick: true,
      }),
    );
    await expect(attempt(s.cbcId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("secrets: set, read back, remove; audited; unreachable from the member path", async () => {
    const actor = { userId: s.jackson.id, role: "OWNER" as const };
    const value = `re_integration_test_${Date.now()}_abcdefgh`;
    const saved = await setSecret({
      orgId: s.cbcId,
      actor,
      provider: "NETLIFY_BUILD_HOOK",
      kind: "HOOK_URL",
      value,
    });
    expect(saved.last4).toBe("efgh");
    await expect(getSecret({ orgId: s.cbcId, provider: "NETLIFY_BUILD_HOOK", kind: "HOOK_URL" })).resolves.toBe(value);

    // The accessor is service-only: under the member path (app_user, even OWNER) it is refused.
    const viaMemberPath = withOrgTx(s.cbcId, ({ db }) =>
      db.$queryRaw`SELECT * FROM app.secret_read(${s.cbcId}, ${saved.integrationId}, 'HOOK_URL')`,
    );
    await expect(viaMemberPath).rejects.toBeInstanceOf(ForbiddenError);

    // Only an OWNER removes.
    await expect(
      removeSecret({ orgId: s.cbcId, actor: { userId: s.jackson.id, role: "ADMIN" }, provider: "NETLIFY_BUILD_HOOK" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeSecret({ orgId: s.cbcId, actor, provider: "NETLIFY_BUILD_HOOK" })).resolves.toBe(true);
    await expect(getSecret({ orgId: s.cbcId, provider: "NETLIFY_BUILD_HOOK", kind: "HOOK_URL" })).resolves.toBeNull();

    const audit = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.orgAuditLog.findMany({
        where: { targetId: saved.integrationId },
        select: { action: true, actorId: true, diffJson: true },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["integration.secret_set", "integration.secret_removed"]),
    );
    expect(audit.every((a) => a.actorId === s.jackson.id)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(value);
  });

  it("rate limiter: shared counter, and a rolled-back action still counts", async () => {
    const key = rateLimitKey("integration-test", String(Date.now()));
    const failing = withOrgAction(async () => {
      await checkRateLimit(key, 2, 60);
      throw new Error("rolled back");
    });
    await expect(failing(s.cbcId)).rejects.toThrow("rolled back");
    await expect(checkRateLimit(key, 2, 60)).resolves.toEqual({ allowed: true });
    const third = await checkRateLimit(key, 2, 60);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("event service: an OWNER creates a session through RLS; a MEMBER is refused", async () => {
    const { event } = await withOrgAction(async (ctx) =>
      createEvent(ctx, {
        title: "Integration test workshop",
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000 + 5_400_000),
        kind: "WORKSHOP",
        visibility: "PUBLIC",
        hostUserId: s.jackson.id,
      }),
    )(s.cbcId);
    createdEvents.push(event.id);
    expect(event.term).toMatch(/^(fall|spring)-\d{4}$/);
    const audit = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.orgAuditLog.count({ where: { targetId: event.id, action: "event.created" } }),
    );
    expect(audit).toBe(1);

    requireUserMock.mockResolvedValue(s.kristine);
    await expect(
      withOrgAction(async (ctx) =>
        createEvent(ctx, { title: "Nope", startsAt: new Date(), endsAt: new Date() }),
      )(s.cbcId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("members: the picker shows public fields only, sorted by name", async () => {
    requireUserMock.mockResolvedValue(s.kristine);
    const members = await getOrgMembersForPicker(s.cbcId);
    expect(members.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(members[0]!).sort()).toEqual(["avatar", "id", "image", "name", "role", "title"]);
    const names = members.map((m) => m.name ?? "");
    expect([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))).toEqual(names);
  });
});
