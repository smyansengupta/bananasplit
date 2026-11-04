import { describe, expect, it } from "vitest";

import { groupForDay, groupForPast, inboxKey, parseInboxKey, snoozeUntil } from "./items";

const NY = "America/New_York";

describe("inbox keys", () => {
  it("round-trips a key", () => {
    expect(parseInboxKey(inboxKey("task", "cm1abc"))).toEqual({ kind: "task", id: "cm1abc" });
  });

  it("refuses unknown kinds and odd ids", () => {
    expect(parseInboxKey("note:abc")).toBeNull();
    expect(parseInboxKey("task:")).toBeNull();
    expect(parseInboxKey("task:a b")).toBeNull();
    expect(parseInboxKey(`task:${"x".repeat(65)}`)).toBeNull();
    expect(parseInboxKey(42)).toBeNull();
  });
});

describe("snoozeUntil", () => {
  // Sat Oct 31 2026, 2:20 PM in New York (EDT, UTC-4).
  const now = new Date("2026-10-31T18:20:00Z");

  it("Later today is about three hours on, on the hour", () => {
    expect(snoozeUntil("later", now, NY).toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });

  it("Later today in the evening waits for tomorrow morning", () => {
    const evening = new Date("2026-11-01T00:30:00Z"); // 8:30 PM Oct 31 in New York
    expect(snoozeUntil("later", evening, NY).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  it("Tomorrow is 8 AM tomorrow in the member's zone", () => {
    // Nov 1 2026 is the day clocks go back: 8 AM EST is 13:00 UTC.
    expect(snoozeUntil("tomorrow", now, NY).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  it("Next week is 8 AM next Monday", () => {
    expect(snoozeUntil("week", now, NY).toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
});

describe("groups", () => {
  it("puts dated needs in Overdue, Today, This week or Later", () => {
    expect(groupForDay("2026-10-30", "2026-10-31")).toBe("overdue");
    expect(groupForDay("2026-10-31", "2026-10-31")).toBe("today");
    expect(groupForDay("2026-11-07", "2026-10-31")).toBe("week");
    expect(groupForDay("2026-11-08", "2026-10-31")).toBe("later");
  });

  it("puts updates in Today, This week or Earlier", () => {
    const now = new Date("2026-10-31T18:00:00Z");
    expect(groupForPast(new Date("2026-10-31T13:00:00Z"), now, NY)).toBe("today");
    expect(groupForPast(new Date("2026-10-26T13:00:00Z"), now, NY)).toBe("week");
    expect(groupForPast(new Date("2026-10-20T13:00:00Z"), now, NY)).toBe("earlier");
  });
});
