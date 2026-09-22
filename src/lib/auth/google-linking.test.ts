import { beforeEach, describe, expect, it, vi } from "vitest";

const { authDbMock } = vi.hoisted(() => ({
  authDbMock: {
    $queryRaw: vi.fn(),
    userCredential: { updateMany: vi.fn() },
    user: { updateMany: vi.fn() },
  },
}));
vi.mock("@/server/db/clients", () => ({ authDb: authDbMock }));

const { googleProviderOptions, googleSignInGate, markGoogleEmailVerified, withNormalizedEmails } =
  await import("./google-linking");

const google = { provider: "google" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Google sign-in gate (0A Fix 4(d))", () => {
  it("links a verified credentials user instead of locking them out", () => {
    // Auth.js links by email only when the provider opts in.
    expect(googleProviderOptions.allowDangerousEmailAccountLinking).toBe(true);
    expect(googleProviderOptions.authorization.params.scope).toBe("openid email profile");
  });

  it("refuses a Google profile whose email is not verified", async () => {
    const allowed = await googleSignInGate({
      account: google,
      profile: { email: "victim@example.edu", email_verified: false },
    });
    expect(allowed).toBe(false);
    expect(authDbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("purges an unverified squatter for the verified address before linking", async () => {
    const allowed = await googleSignInGate({
      account: google,
      profile: { email: " Victim@Example.edu", email_verified: true },
    });

    expect(allowed).toBe(true);
    const [sql, email] = authDbMock.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join("?")).toMatch(/app\.purge_unverified_users\(\?\)/);
    expect(email).toBe("victim@example.edu");
    // A squatter the purge had to keep loses its password.
    expect(authDbMock.userCredential.updateMany).toHaveBeenCalledWith({
      where: {
        passwordHash: { not: null },
        user: { email: "victim@example.edu", emailVerified: null },
      },
      data: { passwordHash: null },
    });
  });

  it("does not touch credentials sign-ins", async () => {
    expect(await googleSignInGate({ account: { provider: "credentials" }, profile: null })).toBe(
      true,
    );
    expect(authDbMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("markGoogleEmailVerified", () => {
  it("sets emailVerified from a verified Google profile for the same address", async () => {
    await markGoogleEmailVerified({
      user: { id: "u1", email: "alice@example.edu" },
      account: google,
      profile: { email: "Alice@example.edu", email_verified: true },
    });
    expect(authDbMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", email: "alice@example.edu", emailVerified: null },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it("does nothing when the Google address differs from the account's", async () => {
    await markGoogleEmailVerified({
      user: { id: "u1", email: "alice@example.edu" },
      account: google,
      profile: { email: "someone-else@example.edu", email_verified: true },
    });
    expect(authDbMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing for an unverified profile or another provider", async () => {
    await markGoogleEmailVerified({
      user: { id: "u1", email: "a@example.edu" },
      account: google,
      profile: { email: "a@example.edu", email_verified: false },
    });
    await markGoogleEmailVerified({
      user: { id: "u1", email: "a@example.edu" },
      account: { provider: "credentials" },
      profile: { email: "a@example.edu", email_verified: true },
    });
    expect(authDbMock.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("withNormalizedEmails", () => {
  it("normalizes addresses the adapter writes and looks up", async () => {
    const base = {
      createUser: vi.fn(async (u: { email: string }) => ({ id: "x", emailVerified: null, ...u })),
      getUserByEmail: vi.fn(async () => null),
    };
    const adapter = withNormalizedEmails(base as never);

    await adapter.createUser!({ id: "x", email: "Bob@Example.EDU ", emailVerified: null });
    await adapter.getUserByEmail!(" BOB@example.edu");

    expect(base.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "bob@example.edu" }),
    );
    expect(base.getUserByEmail).toHaveBeenCalledWith("bob@example.edu");
  });
});
