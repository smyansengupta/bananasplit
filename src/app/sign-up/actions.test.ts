import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authDbMock, signInMock, enqueueMock, rateLimitMock, redirectMock } = vi.hoisted(() => ({
  authDbMock: { user: { findUnique: vi.fn(), create: vi.fn() } },
  signInMock: vi.fn(),
  enqueueMock: vi.fn(),
  rateLimitMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
// The Auth.js side (what counts as a rejection vs. a server failure) is
// covered in src/lib/auth/credentials-sign-in.test.ts.
vi.mock("@/lib/auth/credentials-sign-in", () => ({
  credentialsSignIn: signInMock,
  SIGN_IN_UNAVAILABLE_MESSAGE: "Sign-in isn't available right now.",
}));
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

function form(email: string) {
  const data = new FormData();
  data.set("name", "New Person");
  data.set("email", email);
  data.set("password", "correct-horse-battery");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  // These cases describe a real deployment, where an address must be
  // confirmed. Locally, with no sender, the gate is off (see
  // emailVerificationRequired and the local case at the end).
  vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true");
  authDbMock.user.findUnique.mockResolvedValue(null);
  authDbMock.user.create.mockResolvedValue({ id: "u_new" });
  enqueueMock.mockResolvedValue(undefined);
  rateLimitMock.mockResolvedValue({ allowed: true });
  signInMock.mockResolvedValue({ ok: true });
});

/** Runs the action; a redirect comes back as { redirectedTo }. */
async function submit(data: FormData) {
  try {
    return await signUpAction({}, data);
  } catch (error) {
    const url = (error as { url?: string }).url;
    if (url) return { redirectedTo: url };
    throw error;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signUpAction (0A Fix 4(a,b))", () => {
  it("creates an UNVERIFIED account under the normalized email and sends a verification link", async () => {
    const outcome = await submit(form("  New.Person@Example.EDU "));

    const created = authDbMock.user.create.mock.calls[0]?.[0] as {
      data: { email: string; emailVerified?: unknown };
    };
    expect(created.data.email).toBe("new.person@example.edu");
    expect(created.data.emailVerified).toBeNull();
    // The link goes out through the outbox (a verify-email job for the new user).
    expect(enqueueMock).toHaveBeenCalledWith("u_new");
    // Signed in right away, then on to onboarding's "check your email".
    expect(signInMock).toHaveBeenCalledWith(
      "new.person@example.edu",
      "correct-horse-battery",
      "/onboarding",
    );
    expect(outcome).toEqual({ redirectedTo: "/onboarding" });
  });

  it("shows the check-your-email state when the automatic sign-in is refused", async () => {
    signInMock.mockResolvedValue({ ok: false, reason: "rate_limited" });

    const state = await submit(form("a@example.edu"));

    expect(state).toEqual({ checkEmail: "a@example.edu" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("says so when the server cannot sign anyone in, instead of hiding it", async () => {
    signInMock.mockResolvedValue({ ok: false, reason: "unavailable" });

    expect(await submit(form("a@example.edu"))).toEqual({
      checkEmail: "a@example.edu",
      error:
        "Your account was created, but we couldn't sign you in. Sign-in isn't available right now.",
    });

    vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "false");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(await submit(form("b@example.edu"))).toEqual({
      error:
        "Your account was created, but we couldn't sign you in. Sign-in isn't available right now.",
    });
  });

  it("skips confirmation locally, where the link could never arrive", async () => {
    vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");

    const state = await submit(form("local@example.edu"));

    const created = authDbMock.user.create.mock.calls[0]?.[0] as {
      data: { emailVerified?: unknown };
    };
    expect(created.data.emailVerified).toBeInstanceOf(Date);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(state).toEqual({ redirectedTo: "/onboarding" });
  });

  it("still creates the account when the email cannot be queued (resend is offered)", async () => {
    enqueueMock.mockRejectedValue(new Error("db hiccup"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const state = await submit(form("a@example.edu"));

    expect(state).toEqual({ redirectedTo: "/onboarding" });
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
