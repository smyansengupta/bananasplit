import { describe, expect, it } from "vitest";

import { allDayInstants } from "@/lib/calendar/dates";

import { googleCalendarUrl } from "./format";
import { dateLine, dateTile, startShort, whenLine } from "./when";

describe("an all-day event's date", () => {
  // Stored as midnight in the club's timezone: Berlin's October 15 starts at
  // 22:00 UTC on the 14th, Los Angeles's at 07:00 UTC on the 15th.
  const berlin = allDayInstants("2026-10-15", "2026-10-15", "Europe/Berlin");
  const la = allDayInstants("2026-10-15", "2026-10-16", "America/Los_Angeles");

  it("is the organization's date, ahead of UTC or behind it", () => {
    expect(berlin.startsAt.toISOString()).toBe("2026-10-14T22:00:00.000Z");
    expect(dateLine(berlin.startsAt, "Europe/Berlin")).toBe("Thursday, October 15");
    expect(dateTile(berlin.startsAt, "Europe/Berlin")).toEqual({ month: "OCT", day: "15" });
    expect(dateLine(la.startsAt, "America/Los_Angeles")).toBe("Thursday, October 15");
  });

  it("reads as all day in emails", () => {
    expect(whenLine(berlin.startsAt, berlin.endsAt, "Europe/Berlin", true)).toBe(
      "Thursday, October 15, All day",
    );
  });

  it("goes into Google Calendar as dates, the end the day after the last", () => {
    const url = new URL(
      googleCalendarUrl({
        title: "Organization fair",
        ...berlin,
        allDay: true,
        timeZone: "Europe/Berlin",
      }),
    );
    expect(url.searchParams.get("dates")).toBe("20261015/20261016");
    const twoDays = new URL(
      googleCalendarUrl({ title: "Retreat", ...la, allDay: true, timeZone: "America/Los_Angeles" }),
    );
    expect(twoDays.searchParams.get("dates")).toBe("20261015/20261017");
  });

  it("leaves a timed event as UTC times", () => {
    const url = new URL(
      googleCalendarUrl({
        title: "Demo night",
        startsAt: new Date("2026-10-15T22:00:00Z"),
        endsAt: new Date("2026-10-16T00:30:00Z"),
        allDay: false,
        timeZone: "America/New_York",
      }),
    );
    expect(url.searchParams.get("dates")).toBe("20261015T220000Z/20261016T003000Z");
  });
});

describe("startShort", () => {
  const zone = "America/New_York";
  const start = new Date("2026-10-15T23:00:00Z"); // Thu, Oct 15, 7:00 PM EDT

  it("says today and tomorrow in the organization's timezone", () => {
    expect(startShort(start, zone, false, new Date("2026-10-15T14:00:00Z"))).toBe("Today, 7:00 PM");
    // 10 PM EDT on the 14th is already the 15th in UTC.
    expect(startShort(start, zone, false, new Date("2026-10-15T02:00:00Z"))).toBe(
      "Tomorrow, 7:00 PM",
    );
  });

  it("names the day further out, and all-day events", () => {
    expect(startShort(start, zone, false, new Date("2026-10-10T12:00:00Z"))).toBe(
      "Thu, Oct 15, 7:00 PM",
    );
    expect(startShort(start, zone, true, new Date("2026-10-10T12:00:00Z"))).toBe(
      "Thu, Oct 15, All day",
    );
  });
});
