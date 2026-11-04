import { describe, expect, it } from "vitest";

import { DEFAULT_HOURS, hoursSummary, offeredDurations, parseMinuteInput, readOverrides } from "./hours";
import { checkGuestName, cleanAnswer, greetingName } from "./guest";

describe("what a guest types on a booking page", () => {
  it("takes plain names", () => {
    expect(checkGuestName("  Sam   Rivera ")).toEqual({ ok: true, name: "Sam Rivera" });
    expect(checkGuestName("Zoë O'Neil-Ng")).toMatchObject({ ok: true });
    expect(checkGuestName("J.R.R. Tolkien")).toMatchObject({ ok: true });
  });

  it("refuses links, addresses and markup in the name", () => {
    for (const bad of ["https://evil.example/login", "Hi www.evil.example", "evil.example/login", "me@x.org", "<b>Sam</b>", "Sam {{x}}"]) {
      expect(checkGuestName(bad).ok).toBe(false);
    }
    expect(checkGuestName("").ok).toBe(false);
    expect(checkGuestName("a".repeat(81)).ok).toBe(false);
  });

  it("greets by a first name only when it looks like one", () => {
    expect(greetingName("Sam Rivera")).toBe("Sam");
    expect(greetingName("https://evil.example Sam")).toBeNull();
    expect(greetingName("123")).toBeNull();
  });

  it("trims and caps answers", () => {
    expect(cleanAnswer(`  hi ${String.fromCharCode(7)}`)).toBe("hi");
    expect(cleanAnswer("x".repeat(5000))).toHaveLength(1000);
  });
});

describe("a link's hours", () => {
  it("sums up the week", () => {
    expect(hoursSummary(DEFAULT_HOURS)).toBe("Monday to Friday, 9 AM to 5 PM");
  });

  it("offers each allowed length once, the default first", () => {
    expect(offeredDurations(30, [60, 30, 7, 15])).toEqual([30, 60, 15]);
    expect(offeredDurations(31, [])).toEqual([30]);
  });

  it("reads time inputs and one-off dates", () => {
    expect(parseMinuteInput("09:30")).toBe(570);
    expect(parseMinuteInput("23:59")).toBe(1440);
    expect(parseMinuteInput("25:00")).toBeNull();
    expect(readOverrides([{ date: "2026-11-10", ranges: [] }, { date: "bad" }, { date: "2026-11-10", ranges: [[540, 600]] }])).toEqual([
      { date: "2026-11-10", ranges: [[540, 600]] },
    ]);
  });
});
