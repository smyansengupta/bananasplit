// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Resend verification email" on the check-your-email notice: one bucket
 * per account (3 an hour), nothing sent to a verified address, and a failed
 * enqueue reported instead of thrown.
 */

const { identityMock, rateLimitMock, enqueueMock } = vi.hoisted(() => ({
  identityMock: vi.fn(),
  rateLimitMock: vi.fn(),
  enqueueMock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1", email: "verify-test@example.edu", name: null }),
}));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: identityMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateLimitMock,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "in 12 minutes",
}));
vi.mock("@/server/email/verification", () => ({ enqueueVerificationEmail: enqueueMock }));

const { resendVerificationEmailAction } = await import("./actions");

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  identityMock.mockResolvedValue({
    id: "u1",
    email: "verify-test@example.edu",
    emailVerified: null,
  });
  rateLimitMock.mockResolvedValue({ allowed: true });
  enqueueMock.mockResolvedValue(undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("resendVerificationEmailAction", () => {
  it("queues a new link for an unverified account, counted per account", async () => {
    expect(await resendVerificationEmailAction({})).toEqual({ sent: true });
    expect(rateLimitMock).toHaveBeenCalledWith("verify-resend:u1", 3, 3600, { via: "auth" });
    expect(enqueueMock).toHaveBeenCalledWith("u1");
  });

  it("refuses past the limit, with when to try again", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, retryAfterMs: 12 * 60_000 });
    expect(await resendVerificationEmailAction({})).toEqual({
      error: "Too many verification emails requested. Try again in 12 minutes.",
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("sends nothing to an address that is already verified", async () => {
    identityMock.mockResolvedValue({
      id: "u1",
      email: "verify-test@example.edu",
      emailVerified: new Date(),
    });
    expect(await resendVerificationEmailAction({})).toEqual({ verified: true });
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("reports a failed enqueue instead of crashing the page", async () => {
    enqueueMock.mockRejectedValue(new Error("connection reset"));
    expect(await resendVerificationEmailAction({})).toEqual({
      error: "We couldn't send a new link right now. Try again in a few minutes.",
    });
    expect(errorSpy).toHaveBeenCalled();
  });
});
