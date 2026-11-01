// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * The one reader of ItemLink rows and the one resolver, against a mocked
 * database: both ends of a link, a meeting on its meeting page and any
 * other event on the calendar, and the kinds Home links (polls, decisions,
 * announcements) resolving where they live.
 */

vi.mock("@/server/db/context", () => ({}));

const { readLinks, resolveRefs } = await import("./links");

describe("readLinks", () => {
  it("returns each link from the end asked about, either way round, only known kinds", async () => {
    const db = {
      itemLink: {
        findMany: vi.fn(async () => [
          { id: "l1", fromKind: "decision", fromId: "d1", toKind: "event", toId: "e1" },
          { id: "l2", fromKind: "note", fromId: "n1", toKind: "decision", toId: "d1" },
          { id: "l3", fromKind: "decision", fromId: "d1", toKind: "gadget", toId: "g1" },
        ]),
      },
    };
    const ends = await readLinks(db as never, "org", [{ kind: "decision", id: "d1" }], {
      otherKinds: ["event", "note"],
      order: "asc",
    });
    expect(ends).toEqual([
      { at: "decision:d1", other: { kind: "event", id: "e1" }, linkId: "l1" },
      { at: "decision:d1", other: { kind: "note", id: "n1" }, linkId: "l2" },
    ]);
    expect(db.itemLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org",
          OR: [
            { fromKind: "decision", fromId: { in: ["d1"] }, toKind: { in: ["event", "note"] } },
            { toKind: "decision", toId: { in: ["d1"] }, fromKind: { in: ["event", "note"] } },
          ],
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("reads nothing for nothing", async () => {
    const db = { itemLink: { findMany: vi.fn() } };
    expect(await readLinks(db as never, "org", [])).toEqual([]);
    expect(db.itemLink.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveRefs", () => {
  it("opens a meeting on its meeting page and any other event on the calendar", async () => {
    const db = {
      event: {
        findMany: vi.fn(async () => [
          {
            id: "e_board",
            title: "Board",
            startsAt: new Date("2026-11-03T18:00:00Z"),
            kind: "BOARD_MEETING",
            meetingType: null,
          },
          {
            id: "e_sync",
            title: "Exec sync",
            startsAt: new Date("2026-11-04T18:00:00Z"),
            kind: "OTHER",
            meetingType: "Exec",
          },
          {
            id: "e_social",
            title: "Fall social meeting point",
            startsAt: new Date("2026-11-05T18:00:00Z"),
            kind: "SOCIAL",
            meetingType: null,
          },
        ]),
      },
      eventAttendee: { groupBy: vi.fn(async () => [{ eventId: "e_social", _count: { _all: 4 } }]) },
    };
    const out = await resolveRefs(
      db as never,
      "org",
      "cbc",
      ["e_board", "e_sync", "e_social"].map((id) => ({ kind: "event" as const, id })),
    );
    expect(out.get("event:e_board")).toMatchObject({
      href: "/app/cbc/meetings/e_board",
      chip: "meeting",
      detail: "Meeting, Nov 3",
    });
    expect(out.get("event:e_sync")).toMatchObject({
      href: "/app/cbc/meetings/e_sync",
      chip: "meeting",
    });
    // "meeting" in a title doesn't make one.
    expect(out.get("event:e_social")).toMatchObject({
      href: "/app/cbc/calendar/e_social",
      chip: "event",
      detail: "Event, Nov 5, 4 going",
      going: 4,
    });
    expect(db.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, mergedIntoId: null }),
      }),
    );
  });

  it("resolves polls to Forms, decisions to Home and announcements to the Inbox", async () => {
    const db = {
      poll: {
        findMany: vi.fn(async () => [
          { id: "p1", question: "Pizza or tacos?", closesAt: null, closedAt: null },
        ]),
      },
      decision: {
        findMany: vi.fn(async () => [{ id: "d1", question: "T-shirt vendor", status: "OPEN" }]),
      },
      announcement: {
        findMany: vi.fn(async () => [
          { id: "a1", title: "Room change", createdAt: new Date("2026-10-30T12:00:00Z") },
        ]),
      },
    };
    const out = await resolveRefs(db as never, "org", "cbc", [
      { kind: "poll", id: "p1" },
      { kind: "decision", id: "d1" },
      { kind: "announcement", id: "a1" },
    ]);
    expect(out.get("poll:p1")).toMatchObject({
      title: "Pizza or tacos?",
      href: "/app/cbc/forms/polls/p1",
      detail: "Poll, open",
      chip: "poll",
    });
    expect(out.get("decision:d1")).toMatchObject({
      href: "/app/cbc",
      detail: "Decision, open",
      chip: "decision",
    });
    expect(out.get("announcement:a1")).toMatchObject({
      href: "/app/cbc/inbox",
      detail: "Announcement, posted Oct 30",
      chip: "announcement",
    });
  });
});
