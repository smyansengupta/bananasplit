import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, authDbMock } = vi.hoisted(() => ({
  prismaMock: { event: { findMany: vi.fn() } },
  authDbMock: { userCredential: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/db/clients", () => ({ authDb: authDbMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));

const { GET } = await import("./route");
const { hashIcsToken } = await import("@/lib/ics-token");

function call(token: string) {
  return GET(new Request(`http://localhost/api/calendar/feed/${token}`), {
    params: Promise.resolve({ token }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.event.findMany.mockResolvedValue([]);
});

describe("ICS feed (0A Fix 7)", () => {
  it("resolves the token by its sha256 hash only", async () => {
    authDbMock.userCredential.findUnique.mockResolvedValue(null);

    const response = await call("plain-token-1");

    expect(response.status).toBe(404);
    expect(authDbMock.userCredential.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { icsTokenHash: hashIcsToken("plain-token-1") } }),
    );
    expect(prismaMock.event.findMany).not.toHaveBeenCalled();
  });

  it("only includes events in orgs the user is still a member of", async () => {
    authDbMock.userCredential.findUnique.mockResolvedValue({ user: { id: "u1", name: "U" } });

    const response = await call("plain-token-2");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/calendar/);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          attendees: { some: { userId: "u1" } },
          organization: { deletedAt: null, memberships: { some: { userId: "u1" } } },
        },
      }),
    );
  });
});
