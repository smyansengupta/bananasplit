import { describe, expect, it } from "vitest";

import { conferenceOf, normalizeShotEvents, type CalendarShotOutputData } from "./calendar-shot";

type RawEvent = CalendarShotOutputData["events"][number];
const ev = (over: Partial<RawEvent>): RawEvent => ({
  title: "Kickoff",
  date: "2026-10-08",
  startTime: "18:00",
  endDate: null,
  endTime: "19:30",
  timezone: null,
  location: null,
  description: null,
  meetingUrl: null,
  recurrence: null,
  ...over,
});

describe("normalizeShotEvents", () => {
  it("keeps a timed event as read, in the club's zone when the image shows none", () => {
    const { events } = normalizeShotEvents({ events: [ev({})], notes: [] }, "America/New_York");
    expect(events[0]).toMatchObject({
      allDay: false,
      date: "2026-10-08",
      startTime: "18:00",
      endDate: "2026-10-08",
      endTime: "19:30",
      timezone: "America/New_York",
    });
  });

  it("no start time means all day; a missing or backwards end is an hour after the start", () => {
    const { events } = normalizeShotEvents(
      {
        events: [
          ev({ startTime: null, endTime: null, endDate: "2026-10-10" }),
          ev({ startTime: "9:05", endTime: null }),
          ev({ startTime: "23:30", endTime: "22:00" }),
        ],
        notes: [],
      },
      "UTC",
    );
    expect(events[0]).toMatchObject({ allDay: true, startTime: "", endTime: "", endDate: "2026-10-10" });
    expect(events[1]).toMatchObject({ startTime: "09:05", endTime: "10:05" });
    expect(events[2]).toMatchObject({ endDate: "2026-10-09", endTime: "00:30" });
  });

  it("drops events without a real date and accepts only real timezones", () => {
    const { events } = normalizeShotEvents(
      {
        events: [ev({ date: "Thursday" }), ev({ timezone: "Mars/Olympus" }), ev({ timezone: "America/Los_Angeles" })],
        notes: [],
      },
      "America/New_York",
    );
    expect(events).toHaveLength(2);
    expect(events[0].timezone).toBe("America/New_York");
    expect(events[1].timezone).toBe("America/Los_Angeles");
  });

  it("recognises video links and keeps any other link in the description", () => {
    const { events } = normalizeShotEvents(
      {
        events: [
          ev({ meetingUrl: "https://us02web.zoom.us/j/123" }),
          ev({ meetingUrl: "https://example.com/join", description: "Bring a laptop" }),
          ev({ meetingUrl: "http://meet.google.com/abc" }),
        ],
        notes: [],
      },
      "UTC",
    );
    expect(events[0]).toMatchObject({ conferenceProvider: "ZOOM", conferenceUrl: "https://us02web.zoom.us/j/123" });
    expect(events[1]).toMatchObject({ conferenceProvider: "NONE", conferenceUrl: null });
    expect(events[1].description).toBe("Bring a laptop\n\nhttps://example.com/join");
    // Plain http is never treated as a meeting link.
    expect(events[2].conferenceProvider).toBe("NONE");
  });
});

describe("conferenceOf", () => {
  it("knows Meet, Zoom and Teams, over https only", () => {
    expect(conferenceOf("https://meet.google.com/abc-defg-hij")?.provider).toBe("MEET");
    expect(conferenceOf("https://teams.microsoft.com/l/meetup-join/x")?.provider).toBe("TEAMS");
    expect(conferenceOf("https://zoom.us.evil.example/j/1")).toBeNull();
    expect(conferenceOf("javascript:alert(1)")).toBeNull();
    expect(conferenceOf(null)).toBeNull();
  });
});
