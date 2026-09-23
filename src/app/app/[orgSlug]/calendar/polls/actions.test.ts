import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findUnique: vi.fn(), findMany: vi.fn() },
    availabilityPoll: { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
    event: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ event: prismaMock.event, availabilityPoll: prismaMock.availabilityPoll }),
    ),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role } = await import("@/generated/prisma/enums");
const { deletePoll, finalizePoll } = await import("./actions");

const owner = { id: "owner_1", email: "owner@example.edu", name: "Owner" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(owner);
  prismaMock.membership.findUnique.mockResolvedValue({ role: Role.OWNER });
});

describe("polls actions — cross-org access returns not-found (spec 6.2 audit)", () => {
  it("deletePoll: a poll id from another org is treated as not found", async () => {
    // The mocked findFirst already encodes the org-scoped query (it would
    // return null in production when the poll belongs to a different org);
    // this asserts the action surfaces that as a clean error, not a crash
    // or a successful delete.
    prismaMock.availabilityPoll.findFirst.mockResolvedValue(null);

    const result = await deletePoll("org_1", "poll_from_other_org");

    expect(result.error).toMatch(/not found/i);
    expect(prismaMock.availabilityPoll.delete).not.toHaveBeenCalled();
  });

  it("finalizePoll: a poll id from another org is treated as not found", async () => {
    prismaMock.availabilityPoll.findFirst.mockResolvedValue(null);

    const result = await finalizePoll("org_1", "poll_from_other_org", "slot_1");

    expect(result.error).toMatch(/not found/i);
  });

  it("finalizePoll: the query that looks it up is always scoped to this org", async () => {
    prismaMock.availabilityPoll.findFirst.mockImplementation(
      async ({ where }: { where: { organizationId?: string } }) => {
        if (!where.organizationId) {
          throw new Error("cross-org lookup: query is missing an organizationId filter");
        }
        return null;
      },
    );

    await finalizePoll("org_1", "poll_1", "slot_1");

    expect(prismaMock.availabilityPoll.findFirst).toHaveBeenCalled();
  });
});

describe("finalizePoll — only current members become attendees (0A Fix 6)", () => {
  const slot = {
    id: "slot_1",
    startsAt: new Date("2026-01-05T18:00:00.000Z"),
    endsAt: new Date("2026-01-05T18:30:00.000Z"),
  };
  const response = (
    id: string,
    over: { userId?: string | null; guestKeyHash?: string | null; availability?: string },
  ) => ({
    id,
    slotId: "slot_1",
    userId: over.userId ?? null,
    guestName: over.userId ? null : "Guest",
    guestKeyHash: over.guestKeyHash ?? null,
    availability: over.availability ?? "YES",
  });

  beforeEach(() => {
    prismaMock.availabilityPoll.findFirst.mockResolvedValue({
      id: "poll_1",
      organizationId: "org_1",
      createdById: owner.id,
      finalizedEventId: null,
      title: "Sync",
      description: null,
      durationMinutes: 30,
      closesAt: null,
      slots: [slot],
      responses: [
        response("r1", { userId: "member_1" }),
        response("r2", { userId: "outsider_1" }), // signed in, not a member
        response("r3", { guestKeyHash: "hash_a" }),
        response("r4", { guestKeyHash: "hash_b" }),
        response("r5", { userId: "member_2", availability: "NO" }),
      ],
    });
    // Only member_1 is a member of org_1 among the YES respondents.
    prismaMock.membership.findMany.mockResolvedValue([{ userId: "member_1" }]);
    prismaMock.event.create.mockResolvedValue({ id: "event_1" });
    prismaMock.availabilityPoll.update.mockResolvedValue({});
  });

  it("intersects respondents with the org's memberships", async () => {
    const result = await finalizePoll("org_1", "poll_1", "slot_1");

    expect(result.error).toBeUndefined();
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", userId: { in: ["member_1", "outsider_1"] } },
      select: { userId: true },
    });
    const created = prismaMock.event.create.mock.calls[0]?.[0] as {
      data: { attendees?: { create: { userId: string }[] } };
    };
    expect(created.data.attendees?.create).toEqual([{ userId: "member_1" }]);
    // Two guests plus the non-member are reported, not invited.
    expect(result.excludedGuestCount).toBe(3);
  });
});
