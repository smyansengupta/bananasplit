// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Password reset against the real app_auth role on the local database: the
 * link job, peeking, single use, expiry, the new password, the session
 * version bump and the cleanup. Mail goes to an in-memory list. Skipped when
 * the database is not reachable (CI's unit job has none).
 */

// The jobs module reaches the session module, which pulls in next-auth.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("./mailer", () => ({
  getPlatformMailer: () => ({
    send: async (mail: { to: string; subject: string; text: string }) => {
      sent.push(mail);
    },
  }),
  getOrgMailer: vi.fn(),
}));

import { verifyPassword } from "@/lib/auth/password";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withUserTx } from "@/server/db/context";

import { passwordChangedEmailJob, passwordResetEmailJob } from "./jobs";
import {
  hashResetToken,
  peekPasswordResetToken,
  requestPasswordReset,
  resetPassword,
} from "./password-reset";

let reachable = true;
try {
  await authDb.user.count();
} catch {
  reachable = false;
}

const created: string[] = [];
const stamp = Date.now();

async function makeUser(label: string, opts: { verified?: boolean; password?: boolean } = {}) {
  const user = await authDb.user.create({
    data: {
      email: `pwreset-${label}-${stamp}@example.edu`,
      name: label,
      emailVerified: opts.verified === false ? null : new Date(),
      credential: opts.password === false ? undefined : { create: { passwordHash: "old-hash" } },
    },
    select: { id: true, email: true },
  });
  created.push(user.id);
  return user;
}

function job(userId: string, handler = passwordResetEmailJob) {
  return handler({
    id: "job1",
    kind: "password-reset-email",
    organizationId: null,
    payload: { userId },
    dedupeKey: `password-reset-email:${userId}`,
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 20_000,
  });
}

function tokenFromLastMail(): string {
  const m = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(sent.at(-1)?.text ?? "");
  if (!m) throw new Error("no reset link in the mail");
  return m[1];
}

beforeEach(() => {
  sent.length = 0;
});

describe.skipIf(!reachable)("password reset against the local database", () => {
  afterAll(async () => {
    await authDb.user.deleteMany({ where: { id: { in: created } } });
    await disconnectAll();
  });

  it("mails an absolute link and stores only its hash, one live link per user", async () => {
    const user = await makeUser("mail");
    await job(user.id);
    const first = tokenFromLastMail();
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].text).toMatch(new RegExp(`https?://[^/\\s]+/reset-password/${first}`));

    const rows = await authDb.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashResetToken(first));
    expect(rows[0].tokenHash).not.toContain(first);

    await job(user.id);
    const second = tokenFromLastMail();
    expect(await peekPasswordResetToken(first)).toBe("invalid");
    expect(await peekPasswordResetToken(second)).toBe("valid");
    expect(await authDb.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("peeking doesn't spend the link; resetting spends it once and ends old sessions", async () => {
    const user = await makeUser("reset", { verified: false });
    await job(user.id);
    const token = tokenFromLastMail();
    expect(await peekPasswordResetToken(token)).toBe("valid");
    expect(await peekPasswordResetToken(token)).toBe("valid");

    expect(await resetPassword(token, "a new passphrase")).toEqual({ ok: true, userId: user.id });
    const after = await authDb.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        emailVerified: true,
        credential: { select: { passwordHash: true, sessionVersion: true } },
      },
    });
    expect(await verifyPassword("a new passphrase", after.credential!.passwordHash!)).toBe(true);
    expect(after.credential!.sessionVersion).toBe(1);
    // The link proved the inbox.
    expect(after.emailVerified).toBeInstanceOf(Date);

    expect(await peekPasswordResetToken(token)).toBe("invalid");
    expect(await resetPassword(token, "another passphrase")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("revokes every AI app the account connected, in the reset's own transaction", async () => {
    const user = await makeUser("connectors");
    await withUserTx(user.id, ({ db }) =>
      db.connectorGrant.createMany({
        data: ["client_a", "client_b"].map((clientId) => ({
          userId: user.id,
          clientId: `${clientId}_${stamp}`,
          workosUserId: "user_01WORKOS",
          consentId: "app_consent_1",
        })),
      }),
    );
    await job(user.id);
    expect(await resetPassword(tokenFromLastMail(), "a new passphrase")).toMatchObject({
      ok: true,
    });
    const grants = await withUserTx(user.id, ({ db }) =>
      db.connectorGrant.findMany({ where: { userId: user.id }, select: { revokedAt: true } }),
    );
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.revokedAt instanceof Date)).toBe(true);
  });

  it("refuses an expired link and removes it", async () => {
    const user = await makeUser("expired");
    await job(user.id);
    const token = tokenFromLastMail();
    await authDb.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await peekPasswordResetToken(token)).toBe("expired");
    expect(await resetPassword(token, "a new passphrase")).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await authDb.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("gives a Google-only account its first password", async () => {
    const user = await makeUser("google", { password: false });
    await job(user.id);
    expect(await resetPassword(tokenFromLastMail(), "a new passphrase")).toMatchObject({
      ok: true,
    });
    const credential = await authDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.sessionVersion).toBe(1);
  });

  it("queues nothing for an address with no account, and refuses malformed tokens", async () => {
    await expect(requestPasswordReset(`nobody-${stamp}@example.edu`)).resolves.toBeUndefined();
    expect(await peekPasswordResetToken("short")).toBe("invalid");
    expect(await resetPassword("../../etc", "a new passphrase")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("tells the owner the password changed", async () => {
    const user = await makeUser("notice");
    await job(user.id, passwordChangedEmailJob);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].subject).toMatch(/password was changed/);
  });
});
