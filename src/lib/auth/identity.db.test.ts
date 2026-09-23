// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The 0A identity fixes against the real app_auth role and the definer
 * function app.purge_unverified_users on the local database. Skipped when
 * the database is not reachable (CI's unit job has none).
 */

// The wrappers import the session module, which pulls in next-auth.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { authDb, disconnectAll, legacyDb } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";

import { consumeEmailVerification, issueEmailVerification } from "./email-verification";
import { googleSignInGate } from "./google-linking";

let cbcId: string | null = null;
try {
  const cbc = await legacyDb.organization.findUnique({
    where: { slug: "claude-builders-club" },
    select: { id: true },
  });
  await authDb.user.count();
  cbcId = cbc?.id ?? null;
} catch {
  cbcId = null;
}

const created: string[] = [];
const stamp = Date.now();

async function makeUser(label: string, opts: { verified: boolean; password?: boolean }) {
  const user = await authDb.user.create({
    data: {
      email: `a2-${label}-${stamp}@example.edu`,
      name: label,
      emailVerified: opts.verified ? new Date() : null,
      credential: opts.password ? { create: { passwordHash: "bcrypt-placeholder" } } : undefined,
    },
    select: { id: true, email: true },
  });
  created.push(user.id);
  return user;
}

const verifiedGoogle = (email: string) => ({
  account: { provider: "google" },
  profile: { email: email.toUpperCase(), email_verified: true },
});

describe.skipIf(!cbcId)("identity fixes against the local database", () => {
  afterAll(async () => {
    await authDb.user.deleteMany({ where: { id: { in: created } } });
    await disconnectAll();
  });

  it("a verified Google sign-in purges an unverified password squatter", async () => {
    const squatter = await makeUser("squatter", { verified: false, password: true });

    expect(await googleSignInGate(verifiedGoogle(squatter.email))).toBe(true);

    expect(await authDb.user.findUnique({ where: { id: squatter.id } })).toBeNull();
  });

  it("keeps a verified credentials user, so Auth.js links Google to it", async () => {
    const owner = await makeUser("verified", { verified: true, password: true });

    expect(await googleSignInGate(verifiedGoogle(owner.email))).toBe(true);

    const after = await authDb.user.findUnique({
      where: { id: owner.id },
      select: { credential: { select: { passwordHash: true } } },
    });
    expect(after?.credential?.passwordHash).toBe("bcrypt-placeholder");
  });

  it("an unverified account that joined an org is kept but loses its password", async () => {
    const joined = await makeUser("joined", { verified: false, password: true });
    await withSystemOrgTx(cbcId!, { userId: joined.id }, async ({ db }) => {
      await db.membership.create({
        data: { organizationId: cbcId!, userId: joined.id, role: "MEMBER" },
      });
    });

    expect(await googleSignInGate(verifiedGoogle(joined.email))).toBe(true);

    const after = await authDb.user.findUnique({
      where: { id: joined.id },
      select: { credential: { select: { passwordHash: true } } },
    });
    expect(after).not.toBeNull();
    expect(after?.credential?.passwordHash).toBeNull();
  });

  it("an unverified Google profile is refused and purges nothing", async () => {
    const squatter = await makeUser("kept", { verified: false, password: true });

    expect(
      await googleSignInGate({
        account: { provider: "google" },
        profile: { email: squatter.email, email_verified: false },
      }),
    ).toBe(false);
    expect(await authDb.user.findUnique({ where: { id: squatter.id } })).not.toBeNull();
  });

  it("an emailed token verifies the address once", async () => {
    const person = await makeUser("verify", { verified: false, password: true });
    const token = await issueEmailVerification(person.email);

    expect(await consumeEmailVerification(token)).toEqual({ ok: true, email: person.email });
    const after = await authDb.user.findUniqueOrThrow({
      where: { id: person.id },
      select: { emailVerified: true },
    });
    expect(after.emailVerified).toBeInstanceOf(Date);
    expect(await consumeEmailVerification(token)).toEqual({ ok: false, reason: "invalid" });
    expect(await authDb.verificationToken.count({ where: { identifier: person.email } })).toBe(0);
  });
});
