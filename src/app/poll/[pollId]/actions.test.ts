import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Public poll responses (0A Fix 6): who answers as whom, and the guest edit
 * key that replaced the delete-by-name overwrite.
 */

const { prismaMock, cookieJar, getSessionMock } = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    cookieJar: {
      jar,
      set: vi.fn((name: string, value: string) => {
        jar.set(name, value);
      }),
    },
    getSessionMock: vi.fn(),
    prismaMock: {
      availabilityPoll: { findUnique: vi.fn() },
      membership: { findUnique: vi.fn() },
      pollResponse: {
        upsert: vi.fn((args: unknown) => ({ op: "upsert", args })),
        deleteMany: vi.fn((args: unknown) => ({ op: "deleteMany", args })),
        createMany: vi.fn((args: unknown) => ({ op: "createMany", args })),
      },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.jar.has(name) ? { name, value: cookieJar.jar.get(name)! } : undefined,
    set: cookieJar.set,
  }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));

const { submitPollResponse } = await import("./actions");
const { hashGuestKey } = await import("@/lib/polls/guest-key");

const entries = [{ slotId: "slot_1", availability: "YES" }];

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.jar.clear();
  getSessionMock.mockResolvedValue(null);
  prismaMock.availabilityPoll.findUnique.mockResolvedValue({
    id: "poll_1",
    organizationId: "org_1",
    finalizedEventId: null,
    closesAt: null,
    slots: [{ id: "slot_1" }],
  });
  prismaMock.membership.findUnique.mockResolvedValue(null);
});

describe("submitPollResponse", () => {
  it("gives a new guest an httpOnly key cookie and stores only its hash", async () => {
    const result = await submitPollResponse({ pollId: "poll_1", guestName: "Alex", entries });

    expect(result.error).toBeUndefined();
    expect(cookieJar.set).toHaveBeenCalledWith(
      "poll_guest_poll_1",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/poll/poll_1" }),
    );
    const key = cookieJar.jar.get("poll_guest_poll_1")!;
    const created = prismaMock.pollResponse.createMany.mock.calls[0]?.[0] as {
      data: { guestKeyHash: string; guestName: string; userId?: string }[];
    };
    expect(created.data[0]).toMatchObject({ guestName: "Alex", guestKeyHash: hashGuestKey(key) });
    expect(created.data[0]).not.toHaveProperty("userId");
    expect(JSON.stringify(created)).not.toContain(key);
  });

  it("guest B reusing guest A's name cannot delete A's answers", async () => {
    await submitPollResponse({ pollId: "poll_1", guestName: "Alex", entries });
    const keyA = cookieJar.jar.get("poll_guest_poll_1")!;

    // Guest B: a different browser (no cookie), same name.
    cookieJar.jar.clear();
    await submitPollResponse({ pollId: "poll_1", guestName: "Alex", entries });
    const keyB = cookieJar.jar.get("poll_guest_poll_1")!;

    expect(keyB).not.toBe(keyA);
    const deletes = prismaMock.pollResponse.deleteMany.mock.calls.map(
      (c) => (c[0] as { where: Record<string, unknown> }).where,
    );
    expect(deletes).toEqual([
      { pollId: "poll_1", userId: null, guestKeyHash: hashGuestKey(keyA) },
      { pollId: "poll_1", userId: null, guestKeyHash: hashGuestKey(keyB) },
    ]);
    // Never scoped by name.
    for (const where of deletes) expect(where).not.toHaveProperty("guestName");
  });

  it("a returning guest edits their own rows with the same key", async () => {
    cookieJar.jar.set("poll_guest_poll_1", "k".repeat(43));

    await submitPollResponse({ pollId: "poll_1", guestName: "Alex", entries });

    expect(cookieJar.set).not.toHaveBeenCalled();
    expect(prismaMock.pollResponse.deleteMany).toHaveBeenCalledWith({
      where: { pollId: "poll_1", userId: null, guestKeyHash: hashGuestKey("k".repeat(43)) },
    });
  });

  it("replaces a malformed key cookie instead of trusting it", async () => {
    cookieJar.jar.set("poll_guest_poll_1", "short");
    await submitPollResponse({ pollId: "poll_1", guestName: "Alex", entries });
    expect(cookieJar.set).toHaveBeenCalledOnce();
  });

  it("a signed-in NON-member answers as a guest, never as themselves", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "outsider", email: "o@example.edu", name: "Outsider" },
    });

    const missingName = await submitPollResponse({ pollId: "poll_1", entries });
    expect(missingName.error).toMatch(/enter your name/i);

    await submitPollResponse({ pollId: "poll_1", guestName: "Outsider", entries });
    expect(prismaMock.pollResponse.upsert).not.toHaveBeenCalled();
    const created = prismaMock.pollResponse.createMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>[];
    };
    expect(created.data[0]).not.toHaveProperty("userId");
    expect(prismaMock.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "outsider", organizationId: "org_1" } },
      select: { userId: true },
    });
  });

  it("a signed-in member answers as themselves", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "member_1", email: "m@example.edu", name: "Member" },
    });
    prismaMock.membership.findUnique.mockResolvedValue({ userId: "member_1" });

    const result = await submitPollResponse({ pollId: "poll_1", entries });

    expect(result.error).toBeUndefined();
    expect(prismaMock.pollResponse.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: "member_1", pollId: "poll_1" }),
      }),
    );
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("rejects a slot from another poll", async () => {
    const result = await submitPollResponse({
      pollId: "poll_1",
      guestName: "Alex",
      entries: [{ slotId: "other_slot", availability: "YES" }],
    });
    expect(result.error).toMatch(/isn't part of this poll/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
