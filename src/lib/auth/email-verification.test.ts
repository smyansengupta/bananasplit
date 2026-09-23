import { beforeEach, describe, expect, it, vi } from "vitest";

const { authDbMock } = vi.hoisted(() => ({
  authDbMock: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/server/db/clients", () => ({ authDb: authDbMock }));

const { getUserIdentity } = await import("./email-verification");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserIdentity (0A Fix 4(c))", () => {
  it("reads the stored email and verification state through the identity role", async () => {
    const verifiedAt = new Date("2026-09-01T00:00:00Z");
    authDbMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@example.edu",
      emailVerified: verifiedAt,
    });

    expect(await getUserIdentity("u1")).toEqual({
      id: "u1",
      email: "a@example.edu",
      emailVerified: verifiedAt,
    });
    expect(authDbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { id: true, email: true, emailVerified: true },
    });
  });

  it("returns null for an unknown user", async () => {
    authDbMock.user.findUnique.mockResolvedValue(null);
    expect(await getUserIdentity("missing")).toBeNull();
  });
});
