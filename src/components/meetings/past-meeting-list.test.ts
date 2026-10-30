import { describe, expect, it } from "vitest";

import type { MeetingRow } from "@/components/meetings/meeting-card";

import { groupByMonth } from "./past-meeting-list";

const row = (id: string, iso: string) => ({ id, startsAt: new Date(iso) }) as unknown as MeetingRow;

describe("groupByMonth", () => {
  it("groups by the month in the organization's zone, keeping the order given", () => {
    const groups = groupByMonth(
      [
        row("a", "2026-10-30T22:00:00Z"),
        row("b", "2026-10-02T15:00:00Z"),
        // 11pm on Sep 30 in New York is already October in UTC.
        row("c", "2026-10-01T03:00:00Z"),
      ],
      "America/New_York",
    );
    expect(groups.map((g) => [g.label, g.items.map((e) => e.id)])).toEqual([
      ["October 2026", ["a", "b"]],
      ["September 2026", ["c"]],
    ]);
  });
});
