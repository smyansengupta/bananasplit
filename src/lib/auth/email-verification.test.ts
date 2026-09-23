import { beforeEach, describe, expect, it, vi } from "vitest";

const { authDbMock, txMock, sendMock } = vi.hoisted(() => {
  const txMock = {
    verificationToken: { findFirst: vi.fn(), deleteMany: vi.fn() },
    user: { updateMany: vi.fn() },
  };
  return {
    txMock,
    sendMock: vi.fn(),
    authDbMock: {
      verificationToken: {
        deleteMany: vi.fn((args: unknown) => ({ op: "deleteMany", args })),
        create: vi.fn((args: unknown) => ({ op: "create", args })),
      },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === "function" ? (arg as (tx: unknown) => unknown)(txMock) : arg,
      ),
    },
  };
});
vi.mock("@/server/db/clients", () => ({ authDb: authDbMock }));
vi.mock("@/lib/email", () => ({ sendNotificationEmail: sendMock }));

const {
  consumeEmailVerification,
  hashVerificationToken,
  issueEmailVerification,
  sendVerificationEmail,
} = await import("./email-verification");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("email verification tokens (0A Fix 4(b))", () => {
  it("stores only the sha256 of a fresh token, for the normalized address, replacing older ones", async () => {
    const token = await issueEmailVerification("  New.User@Example.edu ");

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authDbMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "new.user@example.edu" },
    });
    const created = authDbMock.verificationToken.create.mock.calls[0]?.[0] as {
      data: { identifier: string; token: string; expires: Date };
    };
    expect(created.data.identifier).toBe("new.user@example.edu");
    expect(created.data.token).toBe(hashVerificationToken(token));
    expect(created.data.token).not.toBe(token);
    const hours = (created.data.expires.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("emails an absolute link to /verify-email/<token>", async () => {
    await sendVerificationEmail("a@example.edu", "tok123");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.edu",
        body: expect.stringMatching(/https?:\/\/[^\s]+\/verify-email\/tok123/),
      }),
    );
  });

  it("verifies the address behind a valid token and burns every token for it", async () => {
    txMock.verificationToken.findFirst.mockResolvedValue({
      identifier: "a@example.edu",
      token: hashVerificationToken("good"),
      expires: new Date(Date.now() + 60_000),
    });

    const result = await consumeEmailVerification("good");

    expect(result).toEqual({ ok: true, email: "a@example.edu" });
    expect(txMock.verificationToken.findFirst).toHaveBeenCalledWith({
      where: { token: hashVerificationToken("good") },
    });
    expect(txMock.user.updateMany).toHaveBeenCalledWith({
      where: { email: "a@example.edu", emailVerified: null },
      data: { emailVerified: expect.any(Date) },
    });
    expect(txMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "a@example.edu" },
    });
  });

  it("refuses an expired token without verifying anyone", async () => {
    txMock.verificationToken.findFirst.mockResolvedValue({
      identifier: "a@example.edu",
      token: hashVerificationToken("old"),
      expires: new Date(Date.now() - 1000),
    });

    expect(await consumeEmailVerification("old")).toEqual({ ok: false, reason: "expired" });
    expect(txMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown token", async () => {
    txMock.verificationToken.findFirst.mockResolvedValue(null);
    expect(await consumeEmailVerification("nope")).toEqual({ ok: false, reason: "invalid" });
    expect(txMock.user.updateMany).not.toHaveBeenCalled();
    expect(await consumeEmailVerification("")).toEqual({ ok: false, reason: "invalid" });
  });
});
