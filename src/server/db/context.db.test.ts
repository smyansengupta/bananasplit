// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { redirect } from "next/navigation";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";

/**
 * Integration test of the data layer against the real roles and policies on
 * the local database (DATABASE_URL_APP/_SERVICE/_AUTH/_LEGACY in .env), with
 * the seeded Claude Builders Club. Skipped when the database or the seed is
 * not there (CI's unit job has no database; `pnpm test:rls` covers the SQL
 * side in CI).
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { appDb, authDb, disconnectAll, serviceDb } from "./clients";
import { getOrgContextBySlug, withOrgAction, withOrgTx, withSystemOrgTx } from "./context";
import { InvalidReferenceError } from "./errors";

interface Seeded {
  cbcId: string;
  roboticsId: string;
  jackson: { id: string; email: string; name: string | null };
  kristine: { id: string; email: string; name: string | null };
}

/** Slug -> { id } on the service path (app.resolve_org_slug), before any org GUC. */
async function orgBySlug(slug: string) {
  const rows = await serviceDb.$queryRaw<{ id: string }[]>`
    SELECT "organizationId" AS id FROM app.resolve_org_slug(${slug})`;
  return rows[0] ?? null;
}

/**
 * Async, so a missing role URL (no local database, as in CI) rejects inside
 * Promise.all like the service lookups instead of throwing before it and
 * leaving their rejections unhandled.
 */
async function userByEmail(email: string) {
  return authDb.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } });
}

let seeded: Seeded | null = null;
try {
  const [cbc, robotics, jackson, kristine] = await Promise.all([
    orgBySlug("claude-builders-club"),
    orgBySlug("robotics-club"),
    userByEmail("jackson@example.edu"),
    userByEmail("kristine@example.edu"),
  ]);
  if (cbc && robotics && jackson && kristine) {
    seeded = { cbcId: cbc.id, roboticsId: robotics.id, jackson, kristine };
  }
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("data layer against the local database (seeded CBC)", () => {
  const s = seeded as Seeded;
  const createdLabels: string[] = [];

  beforeAll(() => {
    requireUserMock.mockResolvedValue(s.jackson);
  });
  beforeEach(() => {
    requireUserMock.mockResolvedValue(s.jackson);
  });
  afterAll(async () => {
    if (createdLabels.length) {
      await withSystemOrgTx(s.cbcId, async ({ db }) => {
        await db.label.deleteMany({ where: { id: { in: createdLabels } } });
      });
    }
    await disconnectAll();
  });

  it("appDb outside a wrapper fails closed: no context, no rows", async () => {
    await expect(appDb.task.count()).resolves.toBe(0);
    await expect(appDb.user.count()).resolves.toBe(0);
  });

  it("withOrgTx scopes reads to the org the user belongs to", async () => {
    const counts = await withOrgTx(s.cbcId, async ({ db, role }) => ({
      role,
      cbcTasks: await db.task.count(),
      otherOrgTasks: await db.task.count({ where: { organizationId: { not: s.cbcId } } }),
    }));
    expect(counts.role).toBe("OWNER");
    expect(counts.cbcTasks).toBeGreaterThan(0);
    expect(counts.otherOrgTasks).toBe(0);
  });

  it("a non-member gets NotFoundError, never another org's data", async () => {
    await expect(withOrgTx(s.roboticsId, async ({ db }) => db.task.count())).rejects.toBeInstanceOf(NotFoundError);
    await expect(withOrgAction(async () => "ran")(s.roboticsId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the service path is fail-closed without an org and scoped with one", async () => {
    await expect(withSystemOrgTx(null, async ({ db }) => db.task.count())).resolves.toBe(0);
    const scoped = await withSystemOrgTx(s.cbcId, async ({ db }) => ({
      all: await db.task.count(),
      foreign: await db.task.count({ where: { organizationId: s.roboticsId } }),
    }));
    expect(scoped.all).toBeGreaterThan(0);
    expect(scoped.foreign).toBe(0);
  });

  it("a MEMBER cannot write admin-only rows: RLS refuses and the error is mapped", async () => {
    requireUserMock.mockResolvedValue(s.kristine);
    const invite = withOrgAction(async ({ db, organizationId, userId }) =>
      db.invitation.create({
        data: {
          organizationId,
          email: "someone@example.edu",
          role: "MEMBER",
          token: `t-${Date.now()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedById: userId,
        },
      }),
    );
    const error = await invite(s.cbcId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);

    const settings = await withOrgAction(async ({ db }) =>
      db.orgSettings.updateMany({ data: { publicEventsEnabled: false } }),
    )(s.cbcId);
    expect(settings.count).toBe(0);
  });

  it("a foreign reference is mapped to a generic InvalidReferenceError", async () => {
    const foreignTask = await withSystemOrgTx(s.roboticsId, async ({ db }) =>
      db.task.findFirstOrThrow({ select: { id: true } }),
    );
    const assign = withOrgAction(async ({ db, organizationId, userId }) =>
      db.taskAssignee.create({ data: { organizationId, taskId: foreignTask.id, userId } }),
    );
    const error = await assign(s.cbcId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidReferenceError);
    expect((error as Error).message).not.toContain(foreignTask.id);
  });

  it("a throw rolls back the write; a redirect commits it and runs afterCommit first", async () => {
    const name = `itest-${Date.now()}`;
    await expect(
      withOrgAction(async ({ db, organizationId }) => {
        await db.label.create({ data: { organizationId, name: `${name}-rolled-back`, color: "#000000" } });
        throw new Error("boom");
      })(s.cbcId),
    ).rejects.toThrow("boom");

    let seenAfterCommit: number | null = null;
    const error = await withOrgAction(async (ctx) => {
      const label = await ctx.db.label.create({
        data: { organizationId: ctx.organizationId, name: `${name}-committed`, color: "#000000" },
      });
      createdLabels.push(label.id);
      ctx.afterCommit(async () => {
        seenAfterCommit = await withOrgTx(s.cbcId, ({ db }) => db.label.count({ where: { id: label.id } }));
      });
      redirect("/app/claude-builders-club");
    })(s.cbcId).catch((e: unknown) => e);

    expect((error as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT/);
    expect(seenAfterCommit).toBe(1);
    const labels = await withOrgTx(s.cbcId, ({ db }) =>
      db.label.findMany({ where: { name: { startsWith: name } }, select: { name: true } }),
    );
    expect(labels.map((l) => l.name)).toEqual([`${name}-committed`]);
  });

  it("getOrgContextBySlug returns the org, role, switcher list, settings and theme in one go", async () => {
    const ctx = await getOrgContextBySlug("claude-builders-club");
    expect(ctx.organization.id).toBe(s.cbcId);
    expect(ctx.organization.timezone).toBe("America/New_York");
    expect(ctx.role).toBe("OWNER");
    expect(ctx.memberships.map((m) => m.slug)).toContain("claude-builders-club");
    expect(ctx.settings?.taskRequireOwner).toBe(true);
    expect(ctx.theme?.preset).toBe("cbc");
    expect(ctx.organization.activeOrgChartVersionId).not.toBeNull();
  });

  it("each role reaches only its own plane", async () => {
    await expect(authDb.task.count()).rejects.toBeTruthy();
    await expect(appDb.userCredential.count()).rejects.toBeTruthy();
    await expect(serviceDb.userCredential.count()).rejects.toBeTruthy();
    const [row] = await serviceDb.$queryRaw<{ allowed: boolean }[]>`
      SELECT allowed FROM app.rate_limit_hit(${`itest:${Date.now()}`}, 5, 60)`;
    expect(row.allowed).toBe(true);
  });
});
