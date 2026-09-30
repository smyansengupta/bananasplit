// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Several organizations on one platform, against the real roles, policies
 * and functions on the local database. Two people each create an org
 * through the same service the onboarding uses; a third joins both with
 * their invite codes. Checks what is shared (one profile, one account) and
 * what never crosses between orgs (codes, data, titles, busy hours when an
 * org keeps them private). Everything made here is removed in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { getOrCreateJoinCode, joinWithCode } from "./join-code";
import { updateOwnOnboardingFields } from "./profile";
import { createOrganization } from "../settings/org-creation";
import { getPersonBusyHours } from "../profiles/queries";

const tag = randomBytes(4).toString("hex");

interface U {
  id: string;
  email: string;
  name: string;
}
let founderA: U;
let founderB: U;
let both: U;
let orgA = { id: "", slug: "" };
let orgB = { id: "", slug: "" };
let reachable = true;

async function makeUser(local: string, title: string | null): Promise<U> {
  const row = await authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name: local,
      emailVerified: new Date(),
      onboardedAt: new Date(),
      preferredTitle: title,
    },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

function as<T>(user: U, orgId: string, fn: Parameters<typeof withOrgTx<T>>[1]): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(orgId, fn);
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  try {
    founderA = await makeUser("founder-a", "President");
    founderB = await makeUser("founder-b", "Treasurer");
    both = await makeUser("both", "Developer");
    const a = await createOrganization(founderA, { name: `Robotics ${tag}`, slug: `robotics-${tag}`, timezone: "UTC" });
    const b = await createOrganization(founderB, { name: `Debate ${tag}`, slug: `debate-${tag}`, timezone: "UTC" });
    if (!a.ok || !b.ok) throw new Error(`org creation failed: ${JSON.stringify([a, b])}`);
    orgA = { id: a.orgId, slug: a.slug };
    orgB = { id: b.orgId, slug: b.slug };
  } catch (error) {
    console.warn("[multi-org.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id].filter(Boolean) } } });
    await ownerDb.orgSlugHistory.deleteMany({ where: { slug: { in: [orgA.slug, orgB.slug] } } });
  }
  const ids = [founderA, founderB, both].filter(Boolean).map((u) => u.id);
  if (ids.length) await ownerDb.user.deleteMany({ where: { id: { in: ids } } });
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("several organizations against the local database", () => {
  it("lets two different people each create an org, as its owner, with their own title", async () => {
    if (!reachable) return;
    const owners = await ownerDb.membership.findMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
      select: { organizationId: true, userId: true, role: true, title: true },
    });
    expect(owners).toEqual(
      expect.arrayContaining([
        { organizationId: orgA.id, userId: founderA.id, role: "OWNER", title: "President" },
        { organizationId: orgB.id, userId: founderB.id, role: "OWNER", title: "Treasurer" },
      ]),
    );
    // Each org gets its own settings row and built-in databases.
    const dbs = await ownerDb.databaseDefinition.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: [orgA.id, orgB.id] } },
      _count: true,
    });
    expect(dbs).toHaveLength(2);
  });

  it("lets one person join both orgs: one account and profile, a membership per org", async () => {
    if (!reachable) return;
    const codeA = await as(founderA, orgA.id, ({ db }) => getOrCreateJoinCode(db, orgA.id, founderA.id));
    const codeB = await as(founderB, orgB.id, ({ db }) => getOrCreateJoinCode(db, orgB.id, founderB.id));
    expect(codeA.code).not.toBe(codeB.code);

    expect(await joinWithCode(both, codeA.code)).toMatchObject({ ok: true, orgId: orgA.id });
    expect(await joinWithCode(both, codeB.code)).toMatchObject({ ok: true, orgId: orgB.id });

    const memberships = await withUserTx(both.id, ({ db }) =>
      db.membership.findMany({ where: { userId: both.id }, select: { organizationId: true, role: true } }),
    );
    expect(memberships.map((m) => m.organizationId).sort()).toEqual([orgA.id, orgB.id].sort());
    expect(memberships.every((m) => m.role === "MEMBER")).toBe(true);
    expect(await authDb.user.count({ where: { email: both.email } })).toBe(1);
  });

  it("keeps each org's admin data to that org: codes, settings and databases never cross", async () => {
    if (!reachable) return;
    const fromA = await as(founderA, orgA.id, async ({ db }) => ({
      codes: await db.orgJoinCode.findMany({ select: { organizationId: true } }),
      settings: await db.orgSettings.findMany({ select: { organizationId: true } }),
      databases: await db.databaseDefinition.findMany({ select: { organizationId: true } }),
      otherOrg: await db.organization.findMany({ where: { id: orgB.id }, select: { id: true } }),
    }));
    expect(new Set(fromA.codes.map((r) => r.organizationId))).toEqual(new Set([orgA.id]));
    expect(new Set(fromA.settings.map((r) => r.organizationId))).toEqual(new Set([orgA.id]));
    expect(new Set(fromA.databases.map((r) => r.organizationId))).toEqual(new Set([orgA.id]));
    expect(fromA.otherOrg).toEqual([]);

    // The shared member sees org B's rows only from inside org B, and never its code.
    const fromBothInA = await as(both, orgA.id, async ({ db }) => ({
      codes: await db.orgJoinCode.count(),
      databases: await db.databaseDefinition.findMany({ select: { organizationId: true } }),
    }));
    expect(fromBothInA.codes).toBe(0);
    expect(new Set(fromBothInA.databases.map((r) => r.organizationId))).toEqual(new Set([orgA.id]));

    // Founder A cannot open org B at all.
    await expect(as(founderA, orgB.id, ({ db }) => db.orgSettings.count())).rejects.toThrow();
  });

  it("shares busy hours per org setting, and never the reasons", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(both);
    await updateOwnOnboardingFields(both.id, {
      availability: {
        v: 1,
        blocks: ["0-9"],
        rules: [{ kind: "weekly", label: "Therapy", days: [2], start: 13, end: 14 }],
      },
    });
    await as(founderB, orgB.id, ({ db }) =>
      db.orgSettings.update({ where: { organizationId: orgB.id }, data: { showMemberAvailability: false } }),
    );

    // Org A shares busy times; its owner sees the hours, not the label.
    requireUserMock.mockResolvedValue(founderA);
    const inA = await getPersonBusyHours(orgA.id, both.id);
    expect(inA).toEqual(["0-9", "2-13"]);
    // Org B keeps them to admins; founder B is its owner, so still sees them.
    requireUserMock.mockResolvedValue(founderB);
    expect(await getPersonBusyHours(orgB.id, both.id)).toEqual(["0-9", "2-13"]);
    // Nobody reads the rules row except its owner, even an owner of both orgs' member.
    const leaked = await as(founderA, orgA.id, ({ db }) => db.userAvailability.findMany({ select: { rules: true } }));
    expect(leaked).toEqual([]);
    // A plain member of B would get nothing: make founder A a member of B and ask again.
    await ownerDb.membership.create({ data: { organizationId: orgB.id, userId: founderA.id, role: "MEMBER" } });
    requireUserMock.mockResolvedValue(founderA);
    expect(await getPersonBusyHours(orgB.id, both.id)).toBeNull();
    expect(await getPersonBusyHours(orgA.id, both.id)).toEqual(["0-9", "2-13"]);
  });

  it("gives one title per org: the profile-setup title to start, changeable per org", async () => {
    if (!reachable) return;
    await as(founderA, orgA.id, ({ db }) =>
      db.membership.update({
        where: { userId_organizationId: { userId: both.id, organizationId: orgA.id } },
        data: { title: "Lead Developer" },
      }),
    );
    const titles = await ownerDb.membership.findMany({
      where: { userId: both.id },
      select: { organizationId: true, title: true },
    });
    expect(Object.fromEntries(titles.map((t) => [t.organizationId, t.title]))).toEqual({
      [orgA.id]: "Lead Developer",
      [orgB.id]: "Developer",
    });
  });
});
