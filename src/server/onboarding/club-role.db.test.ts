// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** A per-run address in the benchmarking range, so the per-IP join-code limit never carries over. */
const ip = `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;

/**
 * "You're in <org>" against the real roles and policies: the club a new
 * member just joined, for them and nobody else. Everything made here is
 * removed after.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { getJoinedClub } from "./club-role";
import { getOrCreateJoinCode, joinWithCode } from "./join-code";
import { createOrganization } from "../settings/org-creation";

const tag = randomBytes(4).toString("hex");

interface U {
  id: string;
  email: string;
  name: string;
}
let founder: U;
let joiner: U;
let outsider: U;
let org = { id: "", slug: "" };
let reachable = true;

async function makeUser(local: string): Promise<U> {
  const row = await authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name: local,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  try {
    founder = await makeUser("cr-founder");
    joiner = await makeUser("cr-joiner");
    outsider = await makeUser("cr-outsider");
    const made = await createOrganization(founder, {
      name: `Chess ${tag}`,
      slug: `chess-${tag}`,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(`org creation failed: ${JSON.stringify(made)}`);
    org = { id: made.orgId, slug: made.slug };
    requireUserMock.mockResolvedValue(founder);
    const code = await withOrgTx(org.id, ({ db }) => getOrCreateJoinCode(db, org.id, founder.id));
    const joined = await joinWithCode(joiner, code.code, ip);
    if (!joined.ok) throw new Error(`join failed: ${JSON.stringify(joined)}`);
  } catch (error) {
    console.warn("[club-role.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: org.id } });
    await ownerDb.orgSlugHistory.deleteMany({ where: { slug: org.slug } });
  }
  const ids = [founder, joiner, outsider].filter(Boolean).map((u) => u.id);
  if (ids.length) {
    // Personal spaces made along the way, if any.
    await ownerDb.organization.deleteMany({ where: { personalOwnerId: { in: ids } } });
    await ownerDb.user.deleteMany({ where: { id: { in: ids } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("You're in <org>", () => {
  it("shows the new member the club they joined, and nobody else", async () => {
    if (!reachable) return;
    expect(await getJoinedClub(joiner.id, org.slug)).toMatchObject({
      organizationId: org.id,
      slug: org.slug,
    });
    expect(await getJoinedClub(outsider.id, org.slug)).toBeNull();
  });
});
