import { describe, expect, it } from "vitest";

import { allDayInstants } from "@/lib/calendar/dates";

import {
  fromGoogleEvent,
  googleEventId,
  kindOfTitle,
  mirrorDescription,
  parseDescription,
  placeOrNull,
  toGoogleEvent,
  type MirrorSource,
} from "./mapping";

const base: MirrorSource = {
  id: "evt_1",
  organizationId: "org_1",
  title: "Workshop 3: Tool use",
  description: "Bring a laptop.\nPizza after.",
  location: "West Village H 110",
  startsAt: new Date("2026-10-06T22:00:00.000Z"),
  endsAt: new Date("2026-10-06T23:30:00.000Z"),
  allDay: false,
  visibility: "PUBLIC",
  rsvpUrl: "https://lu.ma/cbc-w3",
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
  publicNote: null,
  capacityFull: false,
};

describe("suite -> Google mapping", () => {
  it("uses a deterministic id inside Google's base32hex alphabet and length", () => {
    const id = googleEventId("org_1", "evt_1");
    expect(id).toBe(googleEventId("org_1", "evt_1"));
    expect(id).not.toBe(googleEventId("org_2", "evt_1"));
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(id).toHaveLength(64);
  });

  it("maps timed events to dateTime plus the org timezone, west and east of UTC", () => {
    const ny = toGoogleEvent(base, { timeZone: "America/New_York", calendar: "public" });
    expect(ny.start).toEqual({
      dateTime: "2026-10-06T22:00:00.000Z",
      timeZone: "America/New_York",
    });
    expect(ny.end).toEqual({ dateTime: "2026-10-06T23:30:00.000Z", timeZone: "America/New_York" });
    const tokyo = toGoogleEvent(base, { timeZone: "Asia/Tokyo", calendar: "public" });
    expect(tokyo.start).toEqual({ dateTime: "2026-10-06T22:00:00.000Z", timeZone: "Asia/Tokyo" });
    // An unknown zone falls back to UTC rather than failing the sync.
    expect(
      toGoogleEvent(base, { timeZone: "Nowhere/Land", calendar: "public" }).start.timeZone,
    ).toBe("UTC");
  });

  it("maps all-day events to org-timezone dates with an exclusive end", () => {
    const ny = allDayInstants("2026-10-10", "2026-10-11", "America/New_York");
    const body = toGoogleEvent(
      { ...base, allDay: true, ...ny },
      { timeZone: "America/New_York", calendar: "public" },
    );
    expect(body.start).toEqual({ date: "2026-10-10" });
    expect(body.end).toEqual({ date: "2026-10-12" });

    const tokyo = allDayInstants("2026-10-10", "2026-10-10", "Asia/Tokyo");
    const east = toGoogleEvent(
      { ...base, allDay: true, ...tokyo },
      { timeZone: "Asia/Tokyo", calendar: "public" },
    );
    expect(east.start).toEqual({ date: "2026-10-10" });
    expect(east.end).toEqual({ date: "2026-10-11" });
  });

  it("puts the RSVP link on line 1 of the description (the website's contract)", () => {
    const body = toGoogleEvent(base, { timeZone: "UTC", calendar: "public" });
    expect(body.description.split("\n")[0]).toBe("https://lu.ma/cbc-w3");
    // The website's parser gets the link and the prose back out.
    expect(parseDescription(body.description)).toEqual({
      rsvpUrl: "https://lu.ma/cbc-w3",
      description: "Bring a laptop.\nPizza after.",
    });
    expect(mirrorDescription({ ...base, rsvpUrl: null }, "public")).toBe(
      "Bring a laptop.\nPizza after.",
    );
  });

  it("keeps meeting links and attendees off the public calendar", () => {
    const pub = toGoogleEvent(base, { timeZone: "UTC", calendar: "public" });
    expect(JSON.stringify(pub)).not.toContain("meet.google.com");
    expect(pub).not.toHaveProperty("attendees");
    const internal = toGoogleEvent(
      { ...base, visibility: "INTERNAL" },
      { timeZone: "UTC", calendar: "internal" },
    );
    expect(internal.description).toContain("Join: https://meet.google.com/abc-defg-hij");
  });

  it("tags the mirror with the suite ids", () => {
    const body = toGoogleEvent(base, { timeZone: "UTC", calendar: "public" });
    expect(body.extendedProperties.private).toEqual({ suiteEventId: "evt_1", orgId: "org_1" });
    expect(body.status).toBe("confirmed");
  });
});

describe("Google -> suite mapping (import)", () => {
  it("parses a Google timed event with the RSVP link and a placeholder location", () => {
    const e = fromGoogleEvent(
      {
        id: "g1",
        etag: '"e1"',
        htmlLink: "https://www.google.com/calendar/event?eid=x",
        status: "confirmed",
        summary: "Info Session: Meet CBC",
        description: '<a href="https://lu.ma/info">https://lu.ma/info</a><br>What we build.',
        location: "[No Location Yet]",
        start: { dateTime: "2026-09-17T22:00:00Z" },
        end: { dateTime: "2026-09-17T23:00:00Z" },
      },
      "America/New_York",
    );
    expect(e).toMatchObject({
      googleEventId: "g1",
      title: "Info Session: Meet CBC",
      rsvpUrl: "https://lu.ma/info",
      description: "What we build.",
      location: null,
      kind: "INFO_SESSION",
      allDay: false,
    });
    expect(e?.startsAt.toISOString()).toBe("2026-09-17T22:00:00.000Z");
  });

  it("reads all-day Google dates as org-timezone midnights with the exclusive end", () => {
    const e = fromGoogleEvent(
      {
        id: "g2",
        summary: "Claude Hackathon",
        start: { date: "2026-10-10" },
        end: { date: "2026-10-12" },
      },
      "America/New_York",
    );
    expect(e?.allDay).toBe(true);
    expect(e?.startsAt.toISOString()).toBe("2026-10-10T04:00:00.000Z");
    expect(e?.endsAt.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(e?.kind).toBe("HACKATHON");
  });

  it("skips cancelled events and recognizes the suite's own mirrors", () => {
    expect(
      fromGoogleEvent({ id: "g3", status: "cancelled", start: { date: "2026-10-10" } }, "UTC"),
    ).toBeNull();
    const mirror = fromGoogleEvent(
      {
        id: "g4",
        summary: "x",
        start: { dateTime: "2026-10-10T10:00:00Z" },
        end: { dateTime: "2026-10-10T11:00:00Z" },
        extendedProperties: { private: { suiteEventId: "evt_9", orgId: "org_1" } },
      },
      "UTC",
    );
    expect(mirror?.mirrorOf).toEqual({ suiteEventId: "evt_9", orgId: "org_1" });
  });

  it("ports the website's kindOf and placeOrNull", () => {
    expect(kindOfTitle("Chatathon with AINU")).toBe("HACKATHON");
    expect(kindOfTitle("Spring kickoff")).toBe("INFO_SESSION");
    expect(kindOfTitle("Welcome Social: Board Games")).toBe("SOCIAL");
    expect(kindOfTitle("Prompting Fundamentals")).toBe("WORKSHOP");
    expect(placeOrNull("TBD")).toBeNull();
    expect(placeOrNull("Snell 108 (Zoom link in the invite)")).toBe(
      "Snell 108 (Zoom link in the invite)",
    );
  });
});
