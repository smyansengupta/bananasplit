import { beforeEach, describe, expect, it, vi } from "vitest";

const { authDbMock, signInMock, issueMock, sendMock } = vi.hoisted(() => ({
  authDbMock: { user: { findUnique: vi.fn(), create: vi.fn() } },
  signInMock: vi.fn(),
  issueMock: vi.fn(),
  sendMock: vi.fn(),
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
vi.mock("@/server/db/clients", () => ({ authDb: authDbMock }));
vi.mock("@/lib/auth/email-verification", () => ({
  issueEmailVerification: issueMock,
  sendVerificationEmail: sendMock,
}));
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
  issueMock.mockResolvedValue("plain-token");
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
    expect(issueMock).toHaveBeenCalledWith("new.person@example.edu");
    expect(sendMock).toHaveBeenCalledWith("new.person@example.edu", "plain-token");
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

  it("still creates the account when the email cannot be sent (resend is offered)", async () => {
    sendMock.mockRejectedValue(new Error("mail down"));
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
});
