import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Public poll responses (0A Fix 6), now on the service path: who answers as
 * whom, and the guest edit key that replaced the delete-by-name overwrite.
 */

const { db, cookieJar, getSessionMock, txCalls } = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    cookieJar: {
      jar,
      set: vi.fn((name: string, value: string) => {
        jar.set(name, value);
      }),
    },
    getSessionMock: vi.fn(),
    txCalls: [] as { orgId: string | null; userId: string | null }[],
    db: {
      availabilityPoll: { findFirst: vi.fn() },
      membership: { count: vi.fn() },
      pollResponse: { upsert: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({
    get: (name: string) => (cookieJar.jar.has(name) ? { name, value: cookieJar.jar.get(name)! } : undefined),
    set: cookieJar.set,
  }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("./poll-org", () => ({ pollOrgId: async (id: string) => (id === "poll_1" ? "org_1" : null) }));
vi.mock("@/server/db/context", () => ({
  withSystemOrgTx: async (
    orgId: string | null,
    optsOrFn: { userId?: string | null } | ((c: unknown) => unknown),
    maybeFn?: (c: unknown) => unknown,
  ) => {
    const opts = typeof optsOrFn === "function" ? {} : optsOrFn;
    const fn = (typeof optsOrFn === "function" ? optsOrFn : maybeFn)!;
    txCalls.push({ orgId, userId: opts.userId ?? null });
    return fn({ db, organizationId: orgId });
  },
}));

const { submitPollResponse } = await import("./actions");
const { hashGuestKey } = await import("@/lib/polls/guest-key");

const entries = [{ slotId: "slot_1", availability: "YES" }];

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.jar.clear();
  txCalls.length = 0;
  getSessionMock.mockResolvedValue(null);
  db.availabilityPoll.findFirst.mockResolvedValue({
    id: "poll_1",
    finalizedEventId: null,
    closesAt: null,
    slots: [{ id: "slot_1" }],
  });
  db.membership.count.mockResolvedValue(0);
});

describe("submitPollResponse", () => {
  it("runs on the service path scoped to the poll's org", async () => {
    await submitPollResponse({ pollId: "poll_1", guestName: "Ada", entries });
    expect(txCalls).toEqual([{ orgId: "org_1", userId: null }]);
    expect(db.availabilityPoll.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "poll_1", organizationId: "org_1" } }),
    );
    expect((await submitPollResponse({ pollId: "nope", guestName: "Ada", entries })).error).toMatch(/not found/);
  });

  it("gives a new guest an httpOnly key cookie and stores only its hash", async () => {
    const result = await submitPollResponse({ pollId: "poll_1", guestName: "Ada", entries });
    expect(result).toEqual({});
    expect(cookieJar.set).toHaveBeenCalledWith(
      "poll_guest_poll_1",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/poll/poll_1" }),
    );
    const key = cookieJar.jar.get("poll_guest_poll_1")!;
    const rows = db.pollResponse.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ organizationId: "org_1", guestName: "Ada", guestKeyHash: hashGuestKey(key) });
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it("guest B reusing guest A's name cannot delete A's answers", async () => {
    await submitPollResponse({ pollId: "poll_1", guestName: "Ada", entries });
    const keyA = cookieJar.jar.get("poll_guest_poll_1")!;
    cookieJar.jar.clear(); // a different browser
    await submitPollResponse({ pollId: "poll_1", guestName: "Ada", entries });
    const keyB = cookieJar.jar.get("poll_guest_poll_1")!;
    expect(keyB).not.toBe(keyA);
    const deletes = db.pollResponse.deleteMany.mock.calls.map((c) => c[0].where.guestKeyHash);
    expect(deletes).toEqual([hashGuestKey(keyA), hashGuestKey(keyB)]);
    for (const c of db.pollResponse.deleteMany.mock.calls) {
      expect(c[0].where).toMatchObject({ organizationId: "org_1", pollId: "poll_1", userId: null });
    }
  });

  it("a returning guest edits their own rows with the same key", async () => {
    await submitPollResponse({ pollId: "poll_1", guestName: "Ada", entries });
    const key = cookieJar.jar.get("poll_guest_poll_1")!;
    cookieJar.set.mockClear();
    await submitPollResponse({ pollId: "poll_1", guestName: "Ada L.", entries });
    expect(cookieJar.set).not.toHaveBeenCalled();
    expect(db.pollResponse.deleteMany.mock.calls[1][0].where.guestKeyHash).toBe(hashGuestKey(key));
  });

  it("replaces a malformed key cookie instead of trusting it", async () => {
    cookieJar.jar.set("poll_guest_poll_1", "not a key");
    await submitPollResponse({ pollId: "poll_1", guestName: "Ada", entries });
    expect(cookieJar.jar.get("poll_guest_poll_1")).not.toBe("not a key");
  });

  it("a signed-in NON-member answers as a guest, never as themselves", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u_outsider", email: "o@example.edu", name: "O" } });
    const result = await submitPollResponse({ pollId: "poll_1", guestName: "Olly", entries });
    expect(result).toEqual({});
    expect(db.pollResponse.upsert).not.toHaveBeenCalled();
    expect(db.pollResponse.createMany.mock.calls[0][0].data[0]).not.toHaveProperty("userId");
    expect(db.membership.count).toHaveBeenCalledWith({ where: { organizationId: "org_1", userId: "u_outsider" } });
  });

  it("a signed-in member answers as themselves", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u_member", email: "m@example.edu", name: "M" } });
    db.membership.count.mockResolvedValue(1);
    await submitPollResponse({ pollId: "poll_1", entries });
    expect(txCalls).toEqual([{ orgId: "org_1", userId: "u_member" }]);
    expect(db.pollResponse.upsert).toHaveBeenCalledWith({
      where: { slotId_userId: { slotId: "slot_1", userId: "u_member" } },
      update: { availability: "YES" },
      create: { organizationId: "org_1", pollId: "poll_1", slotId: "slot_1", userId: "u_member", availability: "YES" },
    });
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("rejects a slot from another poll, a closed poll and a finalized poll", async () => {
    expect((await submitPollResponse({ pollId: "poll_1", guestName: "A", entries: [{ slotId: "slot_x", availability: "YES" }] })).error).toMatch(
      /isn't part/,
    );
    db.availabilityPoll.findFirst.mockResolvedValueOnce({ id: "poll_1", finalizedEventId: null, closesAt: new Date(0), slots: [] });
    expect((await submitPollResponse({ pollId: "poll_1", guestName: "A", entries })).error).toMatch(/closed/);
    db.availabilityPoll.findFirst.mockResolvedValueOnce({ id: "poll_1", finalizedEventId: "e", closesAt: null, slots: [] });
    expect((await submitPollResponse({ pollId: "poll_1", guestName: "A", entries })).error).toMatch(/finalized/);
    expect(db.pollResponse.createMany).not.toHaveBeenCalled();
  });

  it("asks a guest for a name", async () => {
    expect((await submitPollResponse({ pollId: "poll_1", entries })).error).toMatch(/name/);
  });
});
