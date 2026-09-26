import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Calendar actions: authorization (ADMIN+ through the event service), the
 * org-timezone all-day conversion, attendees and their notifications.
 * withOrgAction is replaced by a pass-through with a fake ctx; the event
 * service's writes are mocked (its own tests cover it).
 */

const { ctx, db, service, notifyUsers } = vi.hoisted(() => {
  const db = {
    organization: { findUnique: vi.fn() },
    membership: { count: vi.fn() },
    event: { findFirst: vi.fn() },
    eventAttendee: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    db,
    ctx: { role: "ADMIN" as string, userId: "u_admin" },
    service: { createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn() },
    notifyUsers: vi.fn(),
  };
});

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
vi.mock("@/server/notifications", () => ({ notifyUsers }));

const { createEvent, updateEvent, deleteEvent, moveEvent, rsvpToEvent } = await import("./actions");
const { EventValidationError } = await import("@/server/events/service");

const ORG = "org_1";
const timed = {
  title: "Board meeting",
  startsAt: "2026-10-05T22:00:00.000Z",
  endsAt: "2026-10-05T23:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  ctx.role = "ADMIN";
  ctx.userId = "u_admin";
  db.organization.findUnique.mockResolvedValue({ slug: "cbc", timezone: "America/New_York" });
  db.membership.count.mockImplementation(async ({ where }: { where: { userId: { in: string[] } } }) =>
    where.userId.in.filter((id) => id.startsWith("u_")).length,
  );
  db.event.findFirst.mockResolvedValue({
    title: "Board meeting",
    allDay: false,
    startsAt: new Date(timed.startsAt),
    endsAt: new Date(timed.endsAt),
    location: "Curry 344",
    conferenceProvider: "NONE",
    conferenceUrl: null,
    attendees: [{ userId: "u_a" }, { userId: "u_b" }],
  });
  db.eventAttendee.findMany.mockResolvedValue([{ userId: "u_a" }, { userId: "u_admin" }]);
  const saved = (input: Record<string, unknown>) => ({
    event: {
      id: "evt_1",
      title: "Board meeting",
      startsAt: new Date(timed.startsAt),
      endsAt: new Date(timed.endsAt),
      allDay: false,
      location: "Curry 344",
      ...input,
    },
    tags: [],
  });
  service.createEvent.mockImplementation(async (_c: unknown, input: Record<string, unknown>) => saved(input));
  service.updateEvent.mockImplementation(async (_c: unknown, _id: string, patch: Record<string, unknown>) =>
    saved(patch),
  );
  service.deleteEvent.mockImplementation(async () => saved({}));
});

describe("authorization: events are ADMIN+", () => {
  it.each(["MEMBER", "TREASURER"])("a %s cannot create, edit, move or delete", async (role) => {
    ctx.role = role;
    expect((await createEvent(ORG, timed)).error).toMatch(/permission/i);
    expect((await updateEvent(ORG, "evt_1", { title: "x" })).error).toMatch(/permission/i);
    expect((await moveEvent(ORG, "evt_1", { allDay: false, ...timed })).error).toMatch(/permission/i);
    expect((await deleteEvent(ORG, "evt_1")).error).toMatch(/permission/i);
    expect(service.createEvent).not.toHaveBeenCalled();
    expect(service.updateEvent).not.toHaveBeenCalled();
    expect(service.deleteEvent).not.toHaveBeenCalled();
  });

  it("a MEMBER cannot create a PUBLIC event either", async () => {
    ctx.role = "MEMBER";
    expect((await createEvent(ORG, { ...timed, visibility: "PUBLIC" })).error).toMatch(/permission/i);
  });

  it("an ADMIN creates a PUBLIC workshop through the service", async () => {
    const result = await createEvent(ORG, {
      ...timed,
      title: "Workshop 3",
      kind: "WORKSHOP",
      visibility: "PUBLIC",
      rsvpUrl: "https://lu.ma/w3",
      hostUserId: "u_host",
    });
    expect(result).toEqual({ eventId: "evt_1" });
    expect(service.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, role: "ADMIN" }),
      expect.objectContaining({
        title: "Workshop 3",
        kind: "WORKSHOP",
        visibility: "PUBLIC",
        rsvpUrl: "https://lu.ma/w3",
        hostUserId: "u_host",
        allDay: false,
        startsAt: new Date(timed.startsAt),
        endsAt: new Date(timed.endsAt),
      }),
    );
  });

  it("returns the service's validation message", async () => {
    service.createEvent.mockRejectedValueOnce(new EventValidationError("Links must be http(s) URLs."));
    expect(await createEvent(ORG, { ...timed, rsvpUrl: "ftp://x" })).toEqual({ error: "Links must be http(s) URLs." });
  });
});

describe("times", () => {
  it("stores all-day events as org-timezone midnights with an exclusive end", async () => {
    await createEvent(ORG, { title: "Hackathon", allDay: true, startsAt: "2026-10-10", endsAt: "2026-10-11" });
    expect(service.createEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allDay: true,
        startsAt: new Date("2026-10-10T04:00:00.000Z"),
        endsAt: new Date("2026-10-12T04:00:00.000Z"),
      }),
    );
  });

  it("refuses an end before the start", async () => {
    expect((await createEvent(ORG, { ...timed, endsAt: "2026-10-05T21:00:00.000Z" })).error).toMatch(/after/);
    expect((await createEvent(ORG, { title: "x", allDay: true, startsAt: "2026-10-10", endsAt: "2026-10-09" })).error).toMatch(
      /last day/,
    );
  });

  it("moves an all-day event by its first and last day", async () => {
    await moveEvent(ORG, "evt_1", { allDay: true, startsAt: "2026-10-17", endsAt: "2026-10-18" });
    expect(service.updateEvent).toHaveBeenCalledWith(
      expect.anything(),
      "evt_1",
      expect.objectContaining({
        allDay: true,
        startsAt: new Date("2026-10-17T04:00:00.000Z"),
        endsAt: new Date("2026-10-19T04:00:00.000Z"),
      }),
    );
    expect(notifyUsers).not.toHaveBeenCalled(); // a drag is quiet
  });
});

describe("conference links (paste-only, per provider)", () => {
  it.each([
    ["MEET", "https://zoom.us/j/1", /meet\.google\.com/],
    ["OTHER", "http://example.com/m", /https/],
    ["ZOOM", "", /paste a meeting link/i],
    ["NONE", "https://meet.google.com/x", /remove the link/i],
  ])("%s with %s is refused", async (provider, url, message) => {
    const result = await createEvent(ORG, { ...timed, conferenceProvider: provider as never, conferenceUrl: url });
    expect(result.error).toMatch(message);
    expect(service.createEvent).not.toHaveBeenCalled();
  });

  it("accepts a zoom.us subdomain", async () => {
    const result = await createEvent(ORG, {
      ...timed,
      conferenceProvider: "ZOOM",
      conferenceUrl: "https://us02web.zoom.us/j/123",
    });
    expect(result.error).toBeUndefined();
  });
});

describe("attendees", () => {
  it("invites members only, with the org id, and notifies everyone but the actor", async () => {
    expect((await createEvent(ORG, { ...timed, attendeeIds: ["u_a", "outsider"] })).error).toMatch(/aren't members/);
    await createEvent(ORG, { ...timed, attendeeIds: ["u_a", "u_admin"] });
    expect(db.eventAttendee.createMany).toHaveBeenCalledWith({
      data: [
        { organizationId: ORG, eventId: "evt_1", userId: "u_a" },
        { organizationId: ORG, eventId: "evt_1", userId: "u_admin" },
      ],
      skipDuplicates: true,
    });
    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      ORG,
      ["u_a"],
      expect.objectContaining({ type: "EVENT_INVITE", linkUrl: "/app/cbc/calendar/evt_1" }),
    );
  });

  it("diffs attendees on update and tells the rest about a reschedule", async () => {
    await updateEvent(ORG, "evt_1", {
      ...timed,
      startsAt: "2026-10-06T22:00:00.000Z",
      endsAt: "2026-10-06T23:00:00.000Z",
      attendeeIds: ["u_a", "u_c"],
    });
    expect(db.eventAttendee.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, eventId: "evt_1", userId: { in: ["u_b"] } },
    });
    expect(db.eventAttendee.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ organizationId: ORG, eventId: "evt_1", userId: "u_c" }] }),
    );
    const calls = notifyUsers.mock.calls.map((c) => [c[2], (c[3] as { type: string }).type]);
    expect(calls).toEqual([
      [["u_c"], "EVENT_INVITE"],
      [["u_a"], "EVENT_UPDATED"],
    ]);
  });

  it("can skip the reschedule notice", async () => {
    await updateEvent(ORG, "evt_1", {
      startsAt: "2026-10-06T22:00:00.000Z",
      endsAt: "2026-10-06T23:00:00.000Z",
      notifyAttendees: false,
    });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("tells attendees about a cancellation", async () => {
    await deleteEvent(ORG, "evt_1");
    expect(service.deleteEvent).toHaveBeenCalledWith(expect.anything(), "evt_1");
    expect(notifyUsers).toHaveBeenCalledWith(db, ORG, ["u_a"], expect.objectContaining({ type: "EVENT_CANCELLED" }));
  });
});

describe("rsvpToEvent", () => {
  it("any member answers only their own invitation", async () => {
    ctx.role = "MEMBER";
    ctx.userId = "u_a";
    db.eventAttendee.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await rsvpToEvent(ORG, "evt_1", "YES")).toEqual({});
    expect(db.eventAttendee.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, eventId: "evt_1", userId: "u_a" },
      data: { rsvp: "YES" },
    });
    db.eventAttendee.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await rsvpToEvent(ORG, "evt_1", "NO")).error).toMatch(/aren't invited/);
    expect((await rsvpToEvent(ORG, "evt_1", "BOGUS" as never)).error).toMatch(/Invalid/);
  });
});
