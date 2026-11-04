// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The field names' words; nothing in the week needs them, and they bring auth along.
vi.mock("./review", () => ({ changeLabel: (_kind: string, field: string) => field }));

import { onItsOwnWeek, type OnItsOwnKind } from "./on-its-own";

const now = new Date("2026-11-04T18:00:00Z"); // a Wednesday
const at = (kind: OnItsOwnKind, iso: string) => ({ kind, at: new Date(iso) });

describe("the week of Done on its own", () => {
  it("is the seven days ending today, oldest first, with today marked", () => {
    const week = onItsOwnWeek([], now, "UTC");
    expect(week.days.map((d) => d.key)).toEqual([
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
    expect(week.days.map((d) => d.label).join("")).toBe("TFSSMTW");
    expect(week.days.filter((d) => d.today).map((d) => d.key)).toEqual(["2026-11-04"]);
    expect(week.days[0]!.title).toBe("Thu, Oct 29: nothing");
  });

  it("counts sent and changed as done, held back apart, and says so on hover", () => {
    const week = onItsOwnWeek(
      [
        at("sent", "2026-11-04T10:00:00Z"),
        at("changed", "2026-11-04T11:00:00Z"),
        at("held", "2026-11-04T12:00:00Z"),
        at("sent", "2026-11-01T09:00:00Z"),
      ],
      now,
      "UTC",
    );
    expect(week.done).toBe(3);
    expect(week.held).toBe(1);
    expect(week.days.at(-1)).toMatchObject({ done: 2, held: 1, title: "Wed, Nov 4: 2 done, 1 held back" });
  });

  it("puts each thing on the member's own day, and leaves out what's older than the week", () => {
    const week = onItsOwnWeek(
      [at("sent", "2026-11-04T02:00:00Z"), at("sent", "2026-10-28T12:00:00Z")],
      now,
      "America/Los_Angeles",
    );
    expect(week.done).toBe(1);
    expect(week.days.find((d) => d.key === "2026-11-03")?.done).toBe(1);
  });
});
