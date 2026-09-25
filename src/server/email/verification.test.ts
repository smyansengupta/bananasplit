// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-up email verification flow end to end, against an in-memory
 * stand-in for the auth role's tables: the verify-email job mints a token,
 * stores only its hash and mails the link; the page can peek at the token
 * without using it; confirming consumes it once and marks the user verified.
 */

interface TokenRow {
  identifier: string;
  token: string;
  expires: Date;
}
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
}

const store = vi.hoisted(() => ({
  users: [] as UserRow[],
  tokens: [] as TokenRow[],
  sent: [] as { to: string; text: string; html: string }[],
}));

const authDb = vi.hoisted(() => {
  const verificationToken = {
    async findFirst({ where }: { where: { token: string } }) {
      return store.tokens.find((t) => t.token === where.token) ?? null;
    },
    async deleteMany({ where }: { where: { identifier: string } }) {
      const before = store.tokens.length;
      store.tokens = store.tokens.filter((t) => t.identifier !== where.identifier);
      return { count: before - store.tokens.length };
    },
    async create({ data }: { data: TokenRow }) {
      store.tokens.push({ ...data });
      return data;
    },
  };
  const user = {
    async findUnique({ where }: { where: { id?: string; email?: string } }) {
      return (
        store.users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null
      );
    },
    async updateMany({
      where,
      data,
    }: {
      where: { email: string; emailVerified: null };
      data: { emailVerified: Date };
    }) {
      const rows = store.users.filter((u) => u.email === where.email && u.emailVerified === null);
      for (const r of rows) r.emailVerified = data.emailVerified;
      return { count: rows.length };
    },
  };
  const client = {
    verificationToken,
    user,
    async $transaction(arg: unknown) {
      if (typeof arg === "function") return (arg as (tx: unknown) => Promise<unknown>)(client);
      return Promise.all(arg as Promise<unknown>[]);
    },
  };
  return client;
});

vi.mock("@/server/db/clients", () => ({ authDb, serviceDb: {} }));
vi.mock("@/server/db/context", () => ({ withSystemOrgTx: vi.fn(), currentTx: () => undefined }));
vi.mock("./mailer", () => ({
  getPlatformMailer: () => ({
    send: async (message: { to: string; text: string; html: string }) => {
      store.sent.push(message);
      return { id: "test", transport: "sink" };
    },
  }),
  getOrgMailer: vi.fn(),
}));

import { verifyEmailJob } from "./jobs";
import { consumeVerificationToken, peekVerificationToken } from "./verification";

function run(userId: string) {
  return verifyEmailJob({
    id: "job1",
    kind: "verify-email",
    organizationId: null,
    payload: { userId },
    dedupeKey: `verify-email:${userId}`,
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 20_000,
  });
}

function tokenFromLastMail(): string {
  const text = store.sent.at(-1)?.text ?? "";
  const m = /\/verify-email\/([A-Za-z0-9_-]+)/.exec(text);
  if (!m) throw new Error("no link in the mail");
  return m[1];
}

beforeEach(() => {
  store.users = [{ id: "u1", email: "new@example.edu", name: "New Person", emailVerified: null }];
  store.tokens = [];
  store.sent = [];
});

describe("email verification", () => {
  it("mails an absolute link and stores only the token's hash", async () => {
    await run("u1");
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0].to).toBe("new@example.edu");
    const token = tokenFromLastMail();
    expect(store.sent[0].text).toMatch(new RegExp(`https?://[^/\\s]+/verify-email/${token}`));
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0].token).not.toContain(token);
    expect(store.tokens[0].token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("peeking does not use the token; confirming uses it exactly once", async () => {
    await run("u1");
    const token = tokenFromLastMail();
    expect(await peekVerificationToken(token)).toBe("valid");
    expect(await peekVerificationToken(token)).toBe("valid");

    expect(await consumeVerificationToken(token)).toEqual({ ok: true, email: "new@example.edu" });
    expect(store.users[0].emailVerified).toBeInstanceOf(Date);
    expect(await peekVerificationToken(token)).toBe("invalid");
    expect(await consumeVerificationToken(token)).toEqual({ ok: false, reason: "invalid" });
  });

  it("a new link replaces the old one, and an expired link is refused", async () => {
    await run("u1");
    const first = tokenFromLastMail();
    await run("u1");
    const second = tokenFromLastMail();
    expect(await peekVerificationToken(first)).toBe("invalid");
    expect(await peekVerificationToken(second)).toBe("valid");

    store.tokens[0].expires = new Date(Date.now() - 1000);
    expect(await peekVerificationToken(second)).toBe("expired");
    expect(await consumeVerificationToken(second)).toEqual({ ok: false, reason: "expired" });
    expect(store.users[0].emailVerified).toBeNull();
  });

  it("does nothing for a verified or deleted user, and rejects malformed tokens", async () => {
    store.users[0].emailVerified = new Date();
    await run("u1");
    await run("gone");
    expect(store.sent).toHaveLength(0);
    expect(await peekVerificationToken("short")).toBe("invalid");
    expect(await consumeVerificationToken("../../etc/passwd-and-more-chars")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
