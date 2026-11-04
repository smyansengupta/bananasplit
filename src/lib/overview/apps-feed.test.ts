import { describe, expect, it } from "vitest";

import { agoWords, buildAppsFeed, type AppsFeedInput } from "./apps-feed";

const NOW = new Date("2026-11-02T18:50:00Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

function feed(over: Partial<AppsFeedInput> = {}) {
  return buildAppsFeed({
    now: NOW,
    base: "/app/cbc",
    calls: [],
    syncs: [],
    calendarFailed: 0,
    attention: [],
    ai: [],
    ...over,
  });
}

const call = (id: string, startsIn: number, provider = "ZOOM") => ({
  id,
  title: "Weekly exec sync",
  startsAt: min(startsIn),
  endsAt: min(startsIn + 30),
  provider,
  url: "https://zoom.us/j/1",
});

describe("From your apps", () => {
  it("never offers Join to a link that isn't https", () => {
    for (const url of ["javascript:alert(1)", "http://zoom.us/j/1", "zoom.us/j/1"]) {
      expect(feed({ calls: [{ ...call("sync", -5), url }] }).rows).toEqual([]);
    }
  });

  it("leaves out an event that runs all day with a link on it", () => {
    const long = { ...call("fair", -60), endsAt: min(9 * 60) };
    expect(feed({ calls: [long] }).rows).toEqual([]);
  });

  it("puts the call nearest to now first", () => {
    const rows = feed({ calls: [call("early", -25), call("now", -2), call("soon", 5)] }).rows;
    expect(rows.map((r) => r.key)).toEqual(["call:now", "call:soon", "call:early"]);
  });

  it("is empty when nothing is happening", () => {
    expect(feed().rows).toEqual([]);
  });

  it("shows a call on now, live, with Join to its own link", () => {
    const [row] = feed({ calls: [call("sync", -5)] }).rows;
    expect(row).toMatchObject({
      text: "Zoom: Weekly exec sync is on now",
      tone: "live",
      action: { label: "Join", href: "https://zoom.us/j/1", external: true },
    });
  });

  it("shows a call a quarter of an hour out, and not one further off", () => {
    expect(feed({ calls: [call("soon", 10, "MEET")] }).rows[0]?.sub).toBe("Starts in 10 min");
    expect(feed({ calls: [call("later", 40)] }).rows).toEqual([]);
  });

  it("puts live calls first, then what needs fixing, then the rest by time", () => {
    const rows = feed({
      calls: [call("sync", -5)],
      attention: [{ provider: "GOOGLE_CALENDAR", status: "NEEDS_REAUTH" }],
      calendarFailed: 2,
      syncs: [
        { stream: "checkins", lastSyncedAt: min(-20), failed: false },
        { stream: "signups", lastSyncedAt: min(-50), failed: false },
      ],
      ai: [{ name: "Claude", lastUsedAt: min(-5) }],
    }).rows.map((r) => r.text);
    expect(rows).toEqual([
      "Zoom: Weekly exec sync is on now",
      "Google Calendar needs reconnecting",
      "2 events didn't reach Google Calendar",
      "Claude worked in the workspace for you",
      "Website: check-ins and sign-ups synced",
    ]);
  });

  it("names a failed sync's streams without its error", () => {
    const rows = feed({ syncs: [{ stream: "ballots", lastSyncedAt: null, failed: true }] }).rows;
    expect(rows[0]?.text).toBe("The website sync couldn't bring in votes");
  });

  it("leaves out syncs and AI work older than three days", () => {
    expect(
      feed({
        syncs: [{ stream: "checkins", lastSyncedAt: min(-5000), failed: false }],
        ai: [{ name: "ChatGPT", lastUsedAt: min(-5000) }],
      }).rows,
    ).toEqual([]);
  });

  it("words time simply", () => {
    expect(agoWords(min(0), NOW)).toBe("just now");
    expect(agoWords(min(-12), NOW)).toBe("12 min ago");
    expect(agoWords(min(-180), NOW)).toBe("3 h ago");
    expect(agoWords(min(-60 * 30), NOW)).toBe("1 day ago");
  });
});
