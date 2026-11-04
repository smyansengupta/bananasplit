// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  initialsOf,
  longDay,
  monthGrid,
  monthsBetween,
  shortDay,
  timesByDay,
  zoneName,
} from "./booking-calendar";

describe("the booking calendar", () => {
  it("groups open times by their day in the page's timezone", () => {
    const slots = [
      "2026-11-06T19:00:00.000Z",
      "2026-11-06T14:00:00.000Z",
      // 11:30 PM on the 6th in New York, the 7th in UTC.
      "2026-11-07T04:30:00.000Z",
      "2026-11-09T15:00:00.000Z",
    ];
    expect(timesByDay(slots, "America/New_York")).toEqual([
      {
        key: "2026-11-06",
        slots: ["2026-11-06T14:00:00.000Z", "2026-11-06T19:00:00.000Z", "2026-11-07T04:30:00.000Z"],
      },
      { key: "2026-11-09", slots: ["2026-11-09T15:00:00.000Z"] },
    ]);
  });

  it("lays a month out in weeks from Sunday", () => {
    const nov = monthGrid("2026-11");
    expect(nov.label).toBe("November 2026");
    // November 1, 2026 is a Sunday.
    expect(nov.cells[0]).toBe("2026-11-01");
    expect(nov.cells.filter(Boolean)).toHaveLength(30);
    const feb = monthGrid("2027-02");
    // February 1, 2027 is a Monday: one blank first.
    expect(feb.cells.slice(0, 2)).toEqual([null, "2027-02-01"]);
    expect(feb.cells.filter(Boolean)).toHaveLength(28);
  });

  it("lists the months between two, across a year", () => {
    expect(monthsBetween("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthsBetween("2026-11", "2026-11")).toEqual(["2026-11"]);
  });

  it("names days and zones in plain words", () => {
    expect(longDay("2026-11-06")).toBe("Friday, November 6");
    expect(shortDay("2026-11-06")).toBe("Fri Nov 6");
    expect(zoneName("America/New_York")).toBe("Eastern Time");
    expect(zoneName("Not/AZone")).toBe("Not/AZone");
  });

  it("makes initials for an organization with no logo", () => {
    expect(initialsOf("Northside Makers")).toBe("NM");
    expect(initialsOf("  the 4-H group & friends ")).toBe("T4");
    expect(initialsOf("")).toBe("?");
  });
});
