import { describe, expect, it } from "vitest";

import {
  addMinutesLocal,
  memberRoster,
  normalizeActionItems,
  type ActionItemsOutputData,
  type ImportMember,
} from "./action-items";

const members: ImportMember[] = [
  { key: "m1", userId: "u_riley", name: "Riley Chen", title: "President" },
  { key: "m2", userId: "u_sam", name: "Sam Ortiz", title: null },
];

type RawItem = ActionItemsOutputData["items"][number];
const item = (over: Partial<RawItem>): RawItem => ({
  kind: "task",
  title: "Book the room",
  description: null,
  owner: null,
  helpers: [],
  dueDate: null,
  priority: "MEDIUM",
  startsAt: null,
  endsAt: null,
  allDay: false,
  location: null,
  sourceText: "Sam: book the room",
  ...over,
});

describe("normalizeActionItems", () => {
  it("maps member keys to ids and drops keys it never handed out", () => {
    const { items } = normalizeActionItems(
      { items: [item({ owner: "m2", helpers: ["m1", "m2", "m9", "u_riley"] })], notes: [] },
      members,
    );
    expect(items[0].ownerId).toBe("u_sam");
    // The owner isn't also a helper; unknown keys (and raw ids) are dropped.
    expect(items[0].helperIds).toEqual(["u_riley"]);
    expect(normalizeActionItems({ items: [item({ owner: "u_sam" })], notes: [] }, members).items[0].ownerId).toBeNull();
  });

  it("keeps only real dates, and trims and caps text", () => {
    const { items } = normalizeActionItems(
      {
        items: [
          item({ dueDate: "2026-02-30", title: "  Draft   the deck  " }),
          item({ dueDate: "2026-10-09", title: "x".repeat(300) }),
          item({ title: "   " }),
        ],
        notes: ["  check   this  ", ""],
      },
      members,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Draft the deck", dueDate: null });
    expect(items[1].title.length).toBeLessThanOrEqual(200);
    expect(items[1].dueDate).toBe("2026-10-09");
    expect(normalizeActionItems({ items: [], notes: ["  check   this  ", ""] }, members).notes).toEqual(["check this"]);
  });

  it("an event with a day but no time is all-day; one with no day is a task", () => {
    const { items } = normalizeActionItems(
      {
        items: [
          item({ kind: "event", title: "Social", dueDate: "2026-10-16" }),
          item({ kind: "event", title: "Sometime" }),
          item({ kind: "event", title: "Exec", startsAt: "2026-10-08T18:00", endsAt: null, location: " Room 2 " }),
          item({ kind: "event", title: "Backwards", startsAt: "2026-10-08T18:00", endsAt: "2026-10-08T17:00" }),
        ],
        notes: [],
      },
      members,
    );
    expect(items[0]).toMatchObject({ kind: "event", allDay: true, startsAt: "2026-10-16T00:00", endsAt: "2026-10-16T00:00" });
    expect(items[1]).toMatchObject({ kind: "task", startsAt: null, allDay: false });
    expect(items[2]).toMatchObject({ startsAt: "2026-10-08T18:00", endsAt: "2026-10-08T19:00", location: "Room 2", dueDate: "2026-10-08" });
    expect(items[3].endsAt).toBe("2026-10-08T19:00");
  });

  it("a task never carries event fields", () => {
    const { items } = normalizeActionItems(
      { items: [item({ kind: "task", startsAt: "2026-10-08T18:00", location: "Here", allDay: true })], notes: [] },
      members,
    );
    expect(items[0]).toMatchObject({ startsAt: null, endsAt: null, allDay: false, location: null });
  });

  it("stops at 100 items", () => {
    const many = Array.from({ length: 140 }, (_, i) => item({ title: `Task ${i}` }));
    expect(normalizeActionItems({ items: many, notes: [] }, members).items).toHaveLength(100);
  });
});

describe("helpers", () => {
  it("adds minutes to a wall-clock time across midnight", () => {
    expect(addMinutesLocal("2026-10-08T23:30", 60)).toBe("2026-10-09T00:30");
    expect(addMinutesLocal("not a time", 60)).toBe("not a time");
  });

  it("lists members as keys, names and titles only", () => {
    expect(memberRoster(members)).toBe("m1: Riley Chen (President)\nm2: Sam Ortiz");
    expect(memberRoster([])).toBe("(no members listed)");
  });
});
