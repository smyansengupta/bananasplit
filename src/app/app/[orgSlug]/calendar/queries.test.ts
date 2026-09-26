import { describe, expect, it, vi } from "vitest";

// queries.ts reaches the session module through @/server/members.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));

const { parseCalendarRange } = await import("@/lib/calendar/range");
const { canEditEvent, eventInclude, rangeWhere } = await import("./queries");

describe("eventInclude — linked notes follow the notes rules (0A Fix 11)", () => {
  it("never includes deleted notes, and PRIVATE notes only for their author", () => {
    const include = eventInclude("viewer_1");
    expect(include.notes.where).toEqual({
      deletedAt: null,
      OR: [{ visibility: "ORGANIZATION" }, { authorId: "viewer_1" }],
    });
    expect(include.notes.select).toEqual({ id: true, title: true });
  });

  it("shows people through the public user shape only (no emails)", () => {
    const include = eventInclude("viewer_1");
    expect(include.attendees.select.user.select).not.toHaveProperty("email");
    expect(include.host.select).not.toHaveProperty("email");
  });
});

describe("canEditEvent: the event service is ADMIN+", () => {
  const event = { createdById: "creator" };

  it("allows OWNER and ADMIN", () => {
    expect(canEditEvent(event, { userId: "x", role: "OWNER" })).toBe(true);
    expect(canEditEvent(event, { userId: "x", role: "ADMIN" })).toBe(true);
  });

  it("refuses members, treasurers and even the creator", () => {
    expect(canEditEvent(event, { userId: "creator", role: "MEMBER" })).toBe(false);
    expect(canEditEvent(event, { userId: "x", role: "TREASURER" })).toBe(false);
    expect(canEditEvent(event, { userId: "x", role: null })).toBe(false);
  });
});

describe("range-windowed calendar queries", () => {
  it("asks only for events overlapping the window, live and unmerged, with filters", () => {
    const from = new Date("2026-09-27T04:00:00.000Z");
    const to = new Date("2026-11-08T05:00:00.000Z");
    expect(rangeWhere("org_1", { from, to, kinds: ["WORKSHOP"], visibility: "PUBLIC" })).toEqual({
      organizationId: "org_1",
      deletedAt: null,
      mergedIntoId: null,
      startsAt: { lt: to },
      endsAt: { gt: from },
      kind: { in: ["WORKSHOP"] },
      visibility: "PUBLIC",
    });
    expect(rangeWhere("org_1", { from, to })).not.toHaveProperty("kind");
  });

  it("reads ?from=&to= in the org timezone, padded a day each side", () => {
    const r = parseCalendarRange(
      { from: "2026-09-27", to: "2026-11-08", view: "dayGridMonth", kind: "WORKSHOP,BOGUS,SOCIAL", vis: "PUBLIC" },
      "America/New_York",
    );
    expect(r.from.toISOString()).toBe("2026-09-26T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(r.kinds).toEqual(["WORKSHOP", "SOCIAL"]);
    expect(r.visibility).toBe("PUBLIC");
  });

  it("falls back to the month around today for a missing, reversed or huge window", () => {
    const now = new Date("2026-10-15T16:00:00.000Z");
    for (const params of [{}, { from: "2026-10-10", to: "2026-10-01" }, { from: "2020-01-01", to: "2026-01-01" }]) {
      const r = parseCalendarRange(params, "America/New_York", now);
      expect(r.fromKey).toBe("2026-09-27"); // the Sunday on or before Oct 1
      expect(r.toKey).toBe("2026-11-08");
      expect(r.view).toBe("dayGridMonth");
    }
  });
});
