import { describe, expect, it } from "vitest";

import {
  formatWeeklyText,
  privateItemCount,
  summaryLines,
  type WeeklyItem,
  type WeeklySummary,
} from "./weekly-text";

const item = (over: Partial<WeeklyItem> = {}): WeeklyItem => ({
  id: "t1",
  title: "Book the room",
  status: "NOT_STARTED",
  dueKey: "2026-09-25",
  blockedReason: null,
  role: "owner",
  parentTitle: null,
  ...over,
});

const summary: WeeklySummary = {
  weekStart: "2026-09-21",
  done: [item({ id: "d1", title: "Shipped the flyer" })],
  next: [
    item({ id: "n1", title: "Book the room" }),
    item({ id: "n2", title: "Spring exec transition plan", isPrivate: true }),
  ],
  blocked: [item({ id: "b1", title: "Sponsor contract", blockedReason: "waiting on legal" })],
};

describe("summaryLines", () => {
  it("keeps the lines a person can publish", () => {
    const lines = summaryLines(summary, "2026-09-24");
    expect(lines.done).toEqual(["Shipped the flyer"]);
    expect(lines.blocked).toEqual(["Sponsor contract: waiting on legal"]);
  });

  it("drops private tasks: a posted update is readable by the whole org", () => {
    const lines = summaryLines(summary, "2026-09-24");
    expect(lines.next).toHaveLength(1);
    expect(lines.next.join(" ")).not.toContain("Spring exec transition plan");
  });

  it("also keeps a private title out of the copied text", () => {
    const text = formatWeeklyText({
      personName: "Jackson",
      weekStart: "2026-09-21",
      lines: summaryLines(summary, "2026-09-24"),
    });
    expect(text).not.toContain("Spring exec transition plan");
    expect(text).toContain("Book the room");
  });

  it("carries the parent title on a subtask line", () => {
    const lines = summaryLines(
      { ...summary, next: [item({ parentTitle: "Workshop 9" })], done: [], blocked: [] },
      "2026-09-24",
    );
    expect(lines.next[0]).toContain("Workshop 9");
  });
});

describe("privateItemCount", () => {
  it("counts what is being held back, so the composer can say so", () => {
    expect(privateItemCount(summary)).toBe(1);
  });

  it("is zero when nothing is private", () => {
    expect(privateItemCount({ ...summary, next: [item()] })).toBe(0);
  });
});
