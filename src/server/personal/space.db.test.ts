// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Personal spaces and paused clubs against the real roles, policies and
 * triggers on the local database (docs/features/personal-and-clubs.md).
 * Throwaway users and a club are made as the table owner and removed in
 * afterAll (a Personal space goes with its user: ON DELETE CASCADE).
 * Skipped when the database is not reachable, like the other *.db.test.ts
 * files.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { SpaceRefusedError, withOrgAction, withSystemOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { ensurePersonalSpace, getPersonalSpace } from "./space";

const tag = randomBytes(4).toString("hex");
const pausedOrgId = `c_paused_${tag}`;

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
    // A club whose trial ended yesterday (the table owner may set any end).
    await ownerDb.organization.create({
      data: {
        id: pausedOrgId,
        name: "Paused Club",
        slug: `paused-${tag}`,
        timezone: "UTC",
        plan: "TRIAL",
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    await ownerDb.membership.create({
      data: { organizationId: pausedOrgId, userId: other.id, role: "OWNER" },
    });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: pausedOrgId } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [maya, nameless, other].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("ensurePersonalSpace against the local database", () => {
  it("makes one Personal space, named for the person, with them as its only OWNER", async () => {
    if (!reachable) return;
    expect(await getPersonalSpace(maya.id)).toBeNull();
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
      trialEndsAt: null,
      memberships: [{ userId: maya.id, role: "OWNER" }],
    });
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

describe("a paused club against the local database", () => {
  it("refuses writes through withOrgAction, and lets reads and the plan choice run", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(other);
    const write = vi.fn(async () => "wrote");
    await expect(withOrgAction(write)(pausedOrgId)).rejects.toBeInstanceOf(SpaceRefusedError);
    expect(write).not.toHaveBeenCalled();

    await expect(withOrgAction(async () => "read")(pausedOrgId)).resolves.toBe("read");

    // The owner chooses Club: the club is no longer paused.
    await withOrgAction(async ({ db }) =>
      db.organization.update({ where: { id: pausedOrgId }, data: { plan: "CLUB" } }),
    )(pausedOrgId);
    await expect(withOrgAction(write)(pausedOrgId)).resolves.toBe("wrote");
  });
});
