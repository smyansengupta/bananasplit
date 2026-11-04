// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Personal spaces and an organization whose trial ended against the real
 * roles, policies and triggers on the local database
 * (docs/features/personal-and-clubs.md). Throwaway users and an
 * organization are made as the table owner and removed in
 * afterAll (a Personal space goes with its user: ON DELETE CASCADE).
 * Skipped when the database is not reachable, like the other *.db.test.ts
 * files.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { TRIAL_DAYS } from "@/lib/billing/space";
import { authDb, disconnectAll } from "@/server/db/clients";
import { SpaceRefusedError, withOrgAction, withSystemOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { ensurePersonalSpace, getPersonalSpace } from "./space";

const tag = randomBytes(4).toString("hex");
const endedOrgId = `c_ended_${tag}`;

interface U {
  id: string;
  email: string;
  name: string | null;
}
let maya: U;
let nameless: U;
let other: U;
let reachable = true;

async function makeUser(local: string, name: string | null): Promise<U> {
  return authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name,
      emailVerified: new Date(),
      onboardedAt: new Date(),
      timezone: "America/Chicago",
    },
    select: { id: true, email: true, name: true },
  });
}

beforeAll(async () => {
  try {
    maya = await makeUser("maya", "Maya Patel");
    nameless = await makeUser("nameless", null);
    other = await makeUser("other", "Other Person");
    // An organization whose trial ended yesterday (the table owner may set any end).
    await ownerDb.organization.create({
      data: {
        id: endedOrgId,
        name: "Ended Trial",
        slug: `ended-${tag}`,
        timezone: "UTC",
        plan: "TRIAL",
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    await ownerDb.membership.create({
      data: { organizationId: endedOrgId, userId: other.id, role: "OWNER" },
    });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: endedOrgId } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [maya, nameless, other].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("ensurePersonalSpace against the local database", () => {
  it("makes one Personal space, named for the person, with them as its only OWNER, on a Personal Plus trial", async () => {
    if (!reachable) return;
    expect(await getPersonalSpace(maya.id)).toBeNull();
    const before = Date.now();
    const space = await ensurePersonalSpace(maya.id);
    expect(space).toMatchObject({ name: "Maya's space", timezone: "America/Chicago" });
    expect(space.slug).toMatch(/^me-[a-z0-9]{10}$/);

    const row = await ownerDb.organization.findUnique({
      where: { id: space.id },
      select: {
        kind: true,
        plan: true,
        personalOwnerId: true,
        trialEndsAt: true,
        memberships: { select: { userId: true, role: true } },
      },
    });
    expect(row).toEqual({
      kind: "PERSONAL",
      plan: "FREE",
      personalOwnerId: maya.id,
      trialEndsAt: expect.any(Date),
      memberships: [{ userId: maya.id, role: "OWNER" }],
    });
    // Plan FREE with a trial end TRIAL_DAYS out: Personal Plus until then.
    const days = TRIAL_DAYS * 24 * 60 * 60 * 1000;
    expect(row!.trialEndsAt!.getTime()).toBeGreaterThanOrEqual(before + days);
    expect(row!.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now() + days);
  });

  it("is idempotent: again, or twice at once, it is the same space", async () => {
    if (!reachable) return;
    const first = await ensurePersonalSpace(maya.id);
    const [a, b] = await Promise.all([ensurePersonalSpace(maya.id), ensurePersonalSpace(maya.id)]);
    expect(a.id).toBe(first.id);
    expect(b.id).toBe(first.id);
    const both = await Promise.all([
      ensurePersonalSpace(nameless.id),
      ensurePersonalSpace(nameless.id),
    ]);
    expect(both[0].id).toBe(both[1].id);
    expect(both[0].name).toBe("Personal");
    expect(
      await ownerDb.organization.count({
        where: { personalOwnerId: { in: [maya.id, nameless.id] } },
      }),
    ).toBe(2);
  });

  it("never takes a second member, whoever adds it", async () => {
    if (!reachable) return;
    const space = await ensurePersonalSpace(maya.id);
    await expect(
      withSystemOrgTx(space.id, { userId: other.id }, ({ db }) =>
        db.membership.create({
          data: { organizationId: space.id, userId: other.id, role: "MEMBER" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      ownerDb.membership.create({
        data: { organizationId: space.id, userId: other.id, role: "MEMBER" },
      }),
    ).rejects.toThrow();
    expect(await ownerDb.membership.count({ where: { organizationId: space.id } })).toBe(1);
  });
});

describe("an organization whose trial ended, against the local database", () => {
  it("is on Free: nothing pauses, a Team feature is refused until the owner picks Team", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(other);
    // A reverse trial: reads and writes of what Free includes still run.
    await expect(withOrgAction(async () => "read")(endedOrgId)).resolves.toBe("read");
    await expect(withOrgAction(async () => "wrote")(endedOrgId)).resolves.toBe("wrote");

    const financeWrite = vi.fn(async () => "wrote");
    await expect(
      withOrgAction(financeWrite, { feature: "finance" })(endedOrgId),
    ).rejects.toBeInstanceOf(SpaceRefusedError);
    expect(financeWrite).not.toHaveBeenCalled();

    // The owner picks Team: Finance opens.
    await withOrgAction(async ({ db }) =>
      db.organization.update({ where: { id: endedOrgId }, data: { plan: "CLUB" } }),
    )(endedOrgId);
    await expect(withOrgAction(financeWrite, { feature: "finance" })(endedOrgId)).resolves.toBe(
      "wrote",
    );
  });
});
