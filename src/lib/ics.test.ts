import { describe, expect, it } from "vitest";

import { buildIcsCalendar, escapeText, eventUid, foldLine, type IcsEvent } from "./ics";

const base: IcsEvent = {
  id: "evt_1",
  title: "Workshop 3: Tool use",
  description: "Bring a laptop.",
  location: "West Village H 110",
  startsAt: new Date("2026-10-06T22:00:00.000Z"),
  endsAt: new Date("2026-10-06T23:30:00.000Z"),
  allDay: false,
  updatedAt: new Date("2026-09-20T12:00:00.000Z"),
  sequence: 4,
  url: "https://lu.ma/cbc-w3",
};

function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

describe("buildIcsCalendar", () => {
  it("writes stable UIDs, SEQUENCE, STATUS, URL and LAST-MODIFIED", () => {
    const ics = buildIcsCalendar([base], { name: "CBC", uidHost: "portal.example.org" });
    expect(ics).toContain("UID:evt_1@portal.example.org\r\n");
    expect(ics).toContain("SEQUENCE:4\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).toContain("URL:https://lu.ma/cbc-w3\r\n");
    expect(ics).toContain("LAST-MODIFIED:20260920T120000Z\r\n");
    expect(ics).toContain("DTSTAMP:20260920T120000Z\r\n");
    expect(ics).toContain("DTSTART:20261006T220000Z\r\n");
    expect(ics).toContain("DTEND:20261006T233000Z\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(eventUid("x", "h")).toBe("x@h");
  });

  it("is byte-identical for the same input (no clock reads)", () => {
    const a = buildIcsCalendar([base], { uidHost: "h" });
    const b = buildIcsCalendar([base], { uidHost: "h" });
    expect(a).toBe(b);
  });

  it("writes all-day events as DATE values in the org timezone with an exclusive DTEND", () => {
    // Midnight Oct 10 to midnight Oct 12 in New York: two days.
    const allDay: IcsEvent = {
      ...base,
      allDay: true,
      startsAt: new Date("2026-10-10T04:00:00.000Z"),
      endsAt: new Date("2026-10-12T04:00:00.000Z"),
    };
    const ny = buildIcsCalendar([allDay], { timeZone: "America/New_York", uidHost: "h" });
    expect(ny).toContain("DTSTART;VALUE=DATE:20261010\r\n");
    expect(ny).toContain("DTEND;VALUE=DATE:20261012\r\n");
    expect(ny).toContain("X-WR-TIMEZONE:America/New_York\r\n");
    // The same instants read in UTC would start on the 10th too, but a
    // Tokyo org's midnight is the previous UTC evening.
    const tokyo: IcsEvent = {
      ...base,
      allDay: true,
      startsAt: new Date("2026-10-09T15:00:00.000Z"),
      endsAt: new Date("2026-10-10T15:00:00.000Z"),
    };
    const out = buildIcsCalendar([tokyo], { timeZone: "Asia/Tokyo", uidHost: "h" });
    expect(out).toContain("DTSTART;VALUE=DATE:20261010\r\n");
    expect(out).toContain("DTEND;VALUE=DATE:20261011\r\n");
  });

  it("escapes TEXT values", () => {
    expect(escapeText("a,b;c\\d\r\ne\nf")).toBe("a\\,b\\;c\\\\d\\ne\\nf");
  });

  it("drops non-http URLs", () => {
    const ics = buildIcsCalendar([{ ...base, url: "javascript:alert(1)" }], { uidHost: "h" });
    expect(ics).not.toContain("URL:");
  });

  it("folds at 75 octets without splitting multibyte characters", () => {
    const title = "Café ☕ – 日本語のワークショップ 🎉 ".repeat(6);
    const ics = buildIcsCalendar([{ ...base, title }], { uidHost: "h" });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the exact text, so no character was cut in half.
    expect(unfold(ics)).toContain(`SUMMARY:${escapeText(title)}`);
    expect(Buffer.from(ics, "utf8").toString("utf8")).toBe(ics);
  });

  it("folds long ASCII lines with a leading space on continuations", () => {
    const folded = foldLine("X".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every((p) => p.startsWith(" ") && p.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("X".repeat(200));
  });

  it("keeps the old (events, name) signature", () => {
    const ics = buildIcsCalendar([base], "My feed");
    expect(ics).toContain("X-WR-CALNAME:My feed");
  });
});
