import { describe, expect, it } from "vitest";

import { DEFAULT_HOURS, type WeeklyHours } from "./hours";
import { comingWeek, hoursShort, lengthsLine, weekWindow } from "./week";

// A Wednesday.
const now = new Date("2026-11-04T15:00:00Z");

describe("comingWeek", () => {
  it("starts today in the link's zone and runs seven days", () => {
    const days = comingWeek(DEFAULT_HOURS, [], "UTC", now);
    expect(days.map((d) => d.name.slice(0, 3))).toEqual(["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"]);
    expect(days.map((d) => d.today)).toEqual([true, false, false, false, false, false, false]);
    expect(days[3]?.ranges).toEqual([]);
    expect(days[0]?.ranges).toEqual([[540, 1020]]);
  });

  it("reads today in the link's own zone, not the server's", () => {
    const late = new Date("2026-11-05T02:00:00Z");
    expect(comingWeek(DEFAULT_HOURS, [], "America/Los_Angeles", late)[0]?.key).toBe("2026-11-04");
    expect(comingWeek(DEFAULT_HOURS, [], "Asia/Tokyo", late)[0]?.key).toBe("2026-11-05");
  });

  it("shows a one-off date in place of the week", () => {
    const days = comingWeek(
      DEFAULT_HOURS,
      [
        { date: "2026-11-05", ranges: [] },
        { date: "2026-11-07", ranges: [[600, 660]] },
      ],
      "UTC",
      now,
    );
    expect(days[1]?.ranges).toEqual([]);
    expect(days[3]?.ranges).toEqual([[600, 660]]);
  });
});

describe("weekWindow", () => {
  it("keeps 8 to 6 for office hours and stretches to fit anything else", () => {
    expect(weekWindow(comingWeek(DEFAULT_HOURS, [], "UTC", now))).toEqual({ from: 480, to: 1080 });
    const late = comingWeek({ ...DEFAULT_HOURS, "3": [[390, 1290]] }, [], "UTC", now);
    expect(weekWindow(late)).toEqual({ from: 360, to: 1320 });
  });
});

describe("hoursShort", () => {
  const none: WeeklyHours = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };

  it("says the week in a few words", () => {
    expect(hoursShort(DEFAULT_HOURS)).toBe("Mon to Fri, 9 AM to 5 PM");
    expect(hoursShort({ ...none, "2": [[540, 720]] })).toBe("Tuesdays, 9 AM to 12 PM");
    expect(hoursShort({ ...none, "1": [[540, 720]], "3": [[600, 720]] })).toBe("2 days a week");
    expect(hoursShort(none)).toBe("No times set");
  });
});

describe("lengthsLine", () => {
  it("lists the lengths on offer", () => {
    expect(lengthsLine([30])).toBe("30 minutes");
    expect(lengthsLine([30, 60])).toBe("30 or 60 minutes");
    expect(lengthsLine([15, 30, 60])).toBe("15, 30 or 60 minutes");
  });
});
