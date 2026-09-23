import { beforeEach, describe, expect, it, vi } from "vitest";

const { authDbMock, signInMock, enqueueMock, rateLimitMock } = vi.hoisted(() => ({
  authDbMock: { user: { findUnique: vi.fn(), create: vi.fn() } },
  signInMock: vi.fn(),
  enqueueMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
vi.mock("@/server/db/clients", () => ({ authDb: authDbMock }));
vi.mock("@/server/email/verification", () => ({ enqueueVerificationEmail: enqueueMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateLimitMock,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "in a few minutes",
}));
vi.mock("@/lib/request-ip", () => ({ getClientIp: async () => "203.0.113.7" }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: async () => "bcrypt-hash" }));

const { signUpAction } = await import("./actions");
const { AuthError } = await import("next-auth");

function form(email: string) {
  const data = new FormData();
  data.set("name", "New Person");
  data.set("email", email);
  data.set("password", "correct-horse-battery");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  authDbMock.user.findUnique.mockResolvedValue(null);
  authDbMock.user.create.mockResolvedValue({ id: "u_new" });
  enqueueMock.mockResolvedValue(undefined);
  rateLimitMock.mockResolvedValue({ allowed: true });
  signInMock.mockResolvedValue(undefined);
});

describe("signUpAction (0A Fix 4(a,b))", () => {
  it("creates an UNVERIFIED account under the normalized email and sends a verification link", async () => {
    await signUpAction({}, form("  New.Person@Example.EDU "));

    const created = authDbMock.user.create.mock.calls[0]?.[0] as {
      data: { email: string; emailVerified?: unknown };
    };
    expect(created.data.email).toBe("new.person@example.edu");
    expect(created.data).not.toHaveProperty("emailVerified");
    // The link goes out through the outbox (a verify-email job for the new user).
    expect(enqueueMock).toHaveBeenCalledWith("u_new");
    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ email: "new.person@example.edu", redirectTo: "/onboarding" }),
    );
  });

  it("shows the check-your-email state when the automatic sign-in fails", async () => {
    signInMock.mockRejectedValue(new AuthError("nope"));

    const state = await signUpAction({}, form("a@example.edu"));

    expect(state).toEqual({ checkEmail: "a@example.edu" });
  });

  it("still creates the account when the email cannot be queued (resend is offered)", async () => {
    enqueueMock.mockRejectedValue(new Error("db hiccup"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const state = await signUpAction({}, form("a@example.edu"));

    expect(state.error).toBeUndefined();
    expect(authDbMock.user.create).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("refuses an address that already has an account, whatever its case", async () => {
    authDbMock.user.findUnique.mockResolvedValue({ id: "existing" });

    const state = await signUpAction({}, form("Existing@Example.edu"));

    expect(authDbMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "existing@example.edu" },
      select: { id: true },
    });
    expect(state.error).toMatch(/already exists/i);
    expect(authDbMock.user.create).not.toHaveBeenCalled();
  });

  it("refuses when the sign-up rate limit is hit, before touching the database", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const state = await signUpAction({}, form("a@example.edu"));

    expect(state.error).toMatch(/too many sign-up attempts/i);
    expect(authDbMock.user.findUnique).not.toHaveBeenCalled();
    expect(authDbMock.user.create).not.toHaveBeenCalled();
  });
});
