import { describe, expect, it } from "vitest";

import {
  dayHeader,
  intervalLabel,
  plain,
  timeOfDayLabel,
  timeZoneDisplayName,
} from "./poll-format";

describe("poll labels", () => {
  it("folds the spaces server and browser ICU disagree on, so hydration matches", () => {
    expect(plain("5:15\u2009–\u20096:45\u202fPM")).toBe("5:15 – 6:45 PM");
    expect(plain("Oct\u00a02")).toBe("Oct 2");
  });

  it("prints labels with ordinary spaces only", () => {
    const label = intervalLabel(
      new Date("2026-10-01T21:15:00Z"),
      new Date("2026-10-01T22:45:00Z"),
      "America/New_York",
    );
    expect(label).not.toMatch(/[\u00a0\u2009\u202f]/);
    expect(label).toMatch(/5:15/);
    expect(label).toMatch(/6:45/);
  });

  it("names a day key without shifting it through a timezone", () => {
    expect(dayHeader("2026-09-30").date).toMatch(/30/);
    expect(dayHeader("2026-09-30").weekday).toMatch(/Wed/);
  });

  it("drops the minutes on the hour", () => {
    expect(timeOfDayLabel("09:00")).not.toMatch(/:00/);
    expect(timeOfDayLabel("09:30")).toMatch(/9:30/);
  });

  it("names zones the way people say them", () => {
    expect(timeZoneDisplayName("UTC")).toBe("UTC");
    expect(timeZoneDisplayName("America/Los_Angeles")).toMatch(/Los Angeles/);
  });
});
