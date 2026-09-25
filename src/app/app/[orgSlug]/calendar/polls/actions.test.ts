import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Availability polls on the member path: creation in the poll's timezone,
 * org-scoped lookups, and finalizing (ADMIN+, through the event service,
 * attendees = current members only; 0A Fix 6).
 */

const { ctx, db, service } = vi.hoisted(() => ({
  ctx: { role: "ADMIN" as string, userId: "u_admin" },
  db: {
    availabilityPoll: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
    pollSlot: { createMany: vi.fn() },
    membership: { findMany: vi.fn() },
    eventAttendee: { createMany: vi.fn() },
  },
  service: { createEvent: vi.fn() },
}));

vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (c: unknown, ...a: unknown[]) => unknown) =>
    (organizationId: string, ...args: unknown[]) =>
      handler({ db, organizationId, userId: ctx.userId, role: ctx.role, kind: "action" }, ...args),
}));
vi.mock("@/server/events/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/events/service")>()),
  ...service,
}));

const { createPoll, deletePoll, finalizePoll } = await import("./actions");
const { pollSlots } = await import("@/lib/calendar/poll-slots");

const ORG = "org_1";

beforeEach(() => {
  vi.clearAllMocks();
  ctx.role = "ADMIN";
  ctx.userId = "u_admin";
  db.availabilityPoll.create.mockResolvedValue({ id: "poll_1" });
  service.createEvent.mockImplementation(async (_c: unknown, input: Record<string, unknown>) => ({
    event: { id: "evt_1", ...input },
    tags: [],
  }));
});

describe("createPoll", () => {
  it("any member creates a poll; slots carry the org and the poll's timezone", async () => {
    ctx.role = "MEMBER";
    const result = await createPoll(ORG, {
      title: "Exec sync time",
      timezone: "America/New_York",
      dates: ["2026-10-05"],
      dailyStartMinutes: 18 * 60,
      dailyEndMinutes: 19 * 60,
      granularityMinutes: 30,
      durationMinutes: 30,
    });
    expect(result).toEqual({ pollId: "poll_1" });
    expect(db.availabilityPoll.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: ORG, createdById: "u_admin" }),
      }),
    );
    expect(db.pollSlot.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: ORG,
          pollId: "poll_1",
          startsAt: new Date("2026-10-05T22:00:00.000Z"),
          endsAt: new Date("2026-10-05T22:30:00.000Z"),
        },
        {
          organizationId: ORG,
          pollId: "poll_1",
          startsAt: new Date("2026-10-05T22:30:00.000Z"),
          endsAt: new Date("2026-10-05T23:00:00.000Z"),
        },
      ],
    });
  });

  it("rejects an unknown timezone and an empty window", async () => {
    const base = { title: "x", dates: ["2026-10-05"], granularityMinutes: 30, durationMinutes: 30 };
    expect(
      (
        await createPoll(ORG, {
          ...base,
          timezone: "Mars/Base",
          dailyStartMinutes: 0,
          dailyEndMinutes: 60,
        })
      ).error,
    ).toMatch(/timezone/i);
    expect(
      (
        await createPoll(ORG, {
          ...base,
          timezone: "UTC",
          dailyStartMinutes: 60,
          dailyEndMinutes: 60,
        })
      ).error,
    ).toMatch(/end must be after/);
  });

  it("builds slots in local time across a DST change", () => {
    const slots = pollSlots({
      timezone: "America/New_York",
      dates: ["2026-11-01", "2026-10-31"],
      dailyStartMinutes: 9 * 60,
      dailyEndMinutes: 10 * 60,
      granularityMinutes: 60,
    });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-10-31T13:00:00.000Z", // EDT
      "2026-11-01T14:00:00.000Z", // EST
    ]);
  });
});

describe("polls are looked up in this org only", () => {
  it("deletePoll and finalizePoll treat another org's poll as not found", async () => {
    db.availabilityPoll.findFirst.mockResolvedValue(null);
    expect(await deletePoll(ORG, "poll_other")).toEqual({ error: "Poll not found." });
    expect(await finalizePoll(ORG, "poll_other", "slot_1")).toEqual({ error: "Poll not found." });
    for (const call of db.availabilityPoll.findFirst.mock.calls) {
      expect(call[0]).toMatchObject({ where: { id: "poll_other", organizationId: ORG } });
    }
    expect(db.availabilityPoll.delete).not.toHaveBeenCalled();
  });

  it("only the creator or an admin deletes a poll", async () => {
    db.availabilityPoll.findFirst.mockResolvedValue({ id: "poll_1", createdById: "u_creator" });
    ctx.role = "MEMBER";
    expect((await deletePoll(ORG, "poll_1")).error).toMatch(/permission/);
    ctx.userId = "u_creator";
    expect(await deletePoll(ORG, "poll_1")).toEqual({});
    expect(db.availabilityPoll.delete).toHaveBeenCalledWith({ where: { id: "poll_1" } });
  });
});

describe("finalizePoll", () => {
  const poll = {
    id: "poll_1",
    title: "Exec sync",
    description: null,
    durationMinutes: 45,
    closesAt: null,
    finalizedEventId: null,
    slots: [{ id: "slot_1", startsAt: new Date("2026-10-05T22:00:00.000Z") }],
    responses: [
      { id: "r1", slotId: "slot_1", userId: "u_member", guestKeyHash: null, availability: "YES" },
      {
        id: "r2",
        slotId: "slot_1",
        userId: "u_left_the_org",
        guestKeyHash: null,
        availability: "YES",
      },
      {
        id: "r3",
        slotId: "slot_1",
        userId: "u_other_org",
        guestKeyHash: null,
        availability: "IF_NEEDED",
      },
      {
        id: "r4",
        slotId: "slot_1",
        userId: null,
        guestKeyHash: "a".repeat(64),
        availability: "YES",
      },
      { id: "r5", slotId: "slot_1", userId: "u_no", guestKeyHash: null, availability: "NO" },
    ],
  };

  beforeEach(() => {
    db.availabilityPoll.findFirst.mockResolvedValue(poll);
    db.membership.findMany.mockResolvedValue([{ userId: "u_member" }]);
  });

  it("is ADMIN+ (it creates an event)", async () => {
    ctx.role = "MEMBER";
    expect((await finalizePoll(ORG, "poll_1", "slot_1")).error).toMatch(/permission/);
    expect(service.createEvent).not.toHaveBeenCalled();
  });

  it("creates an INTERNAL event with only current members as attendees", async () => {
    const result = await finalizePoll(ORG, "poll_1", "slot_1");
    expect(result).toEqual({ eventId: "evt_1", excludedGuestCount: 3 });
    expect(service.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG }),
      expect.objectContaining({
        title: "Exec sync",
        visibility: "INTERNAL",
        startsAt: new Date("2026-10-05T22:00:00.000Z"),
        endsAt: new Date("2026-10-05T22:45:00.000Z"),
      }),
    );
    expect(db.membership.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, userId: { in: ["u_member", "u_left_the_org", "u_other_org"] } },
      select: { userId: true },
    });
    expect(db.eventAttendee.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: ORG, eventId: "evt_1", userId: "u_member" }],
      skipDuplicates: true,
    });
    expect(db.availabilityPoll.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finalizedEventId: "evt_1" }) }),
    );
  });

  it("refuses a finalized poll and a slot from elsewhere", async () => {
    db.availabilityPoll.findFirst.mockResolvedValueOnce({ ...poll, finalizedEventId: "evt_0" });
    expect((await finalizePoll(ORG, "poll_1", "slot_1")).error).toMatch(/already been finalized/);
    expect((await finalizePoll(ORG, "poll_1", "slot_x")).error).toMatch(/isn't part/);
  });
});
