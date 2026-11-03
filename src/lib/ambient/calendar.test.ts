import { describe, expect, it } from "vitest";

import {
  eventAmbient,
  fewSignups,
  firstClash,
  needsSyncRetry,
  pollClosingSoon,
  timeForEveryone,
  type EventAmbientInput,
} from "./calendar";

const now = new Date("2026-11-04T15:00:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

function event(
  over: Partial<EventAmbientInput> = {},
  rsvp: Partial<EventAmbientInput["rsvp"]> = {},
) {
  return {
    startsAt: h(40),
    endsAt: h(42),
    timeZone: "UTC",
    canEdit: true,
    checkedIn: 0,
    thankedAt: null,
    ...over,
    rsvp: {
      enabled: true,
      url: "https://x/e/abc",
      going: 3,
      waitlist: 0,
      capacity: null,
      waitlistOn: true,
      ...rsvp,
    },
  } satisfies EventAmbientInput;
}

const kinds = (e: EventAmbientInput) => eventAmbient(e, now).map((a) => a.kind);

describe("eventAmbient", () => {
  it("is for those who can edit the event", () => {
    expect(kinds(event({ canEdit: false }))).toEqual([]);
  });

  it("shares the link and reminds members two days out with few sign-ups", () => {
    const [a] = eventAmbient(event(), now);
    expect(a).toEqual({ kind: "share-rsvp", reason: "Starts in 2 days, 3 signed up" });
    expect(kinds(event())).toEqual(["share-rsvp", "remind-members"]);
    expect(kinds(event({}, { going: 12 }))).toEqual([]);
    expect(kinds(event({ startsAt: h(60), endsAt: h(62) }))).toEqual([]);
    expect(kinds(event({}, { enabled: false }))).toEqual([]);
  });

  it("opens a waitlist or adds seats when full", () => {
    expect(kinds(event({}, { capacity: 25, going: 25, waitlistOn: false }))).toEqual([
      "open-waitlist",
      "add-seats",
    ]);
    const [a] = eventAmbient(event({}, { capacity: 25, going: 25, waitlist: 6 }), now);
    expect(a).toEqual({ kind: "add-seats", reason: "25 of 25 spots taken, 6 waiting" });
  });

  it("opens the door on the day", () => {
    expect(kinds(event({ startsAt: h(2), endsAt: h(4) }, { going: 30 }))).toEqual(["door"]);
    expect(kinds(event({ startsAt: h(-3), endsAt: h(-1) }, { going: 30 }))[0]).not.toBe("door");
  });

  it("thanks and logs attendance after it's over", () => {
    const over = { startsAt: h(-26), endsAt: h(-24) };
    expect(kinds(event(over))).toEqual(["thank-you", "log-attendance"]);
    expect(kinds(event({ ...over, thankedAt: h(-1), checkedIn: 4 }))).toEqual([]);
    expect(kinds(event({ startsAt: h(-100), endsAt: h(-98) }))).toEqual([]);
  });

  it("counts few as under half, or under ten", () => {
    expect(fewSignups(9, null)).toBe(true);
    expect(fewSignups(10, null)).toBe(false);
    expect(fewSignups(12, 25)).toBe(true);
    expect(fewSignups(13, 25)).toBe(false);
  });

  it("retries a failed Google sync", () => {
    expect(needsSyncRetry({ googleSyncState: "FAILED", canEdit: true })).toBe(true);
    expect(needsSyncRetry({ googleSyncState: "FAILED", canEdit: false })).toBe(false);
    expect(needsSyncRetry({ googleSyncState: "SYNCED", canEdit: true })).toBe(false);
  });
});

describe("firstClash", () => {
  const e = (id: string, from: number, to: number, allDay = false) => ({
    id,
    title: id,
    startsAt: h(from),
    endsAt: h(to),
    allDay,
  });

  it("finds two overlapping timed events and moves the later one", () => {
    const clash = firstClash([e("a", 0, 2), e("b", 1, 3), e("c", 5, 6)]);
    expect(clash?.keep.id).toBe("a");
    expect(clash?.move.id).toBe("b");
  });

  it("moves the shorter of two that start together", () => {
    expect(firstClash([e("long", 0, 3), e("short", 0, 1)])?.move.id).toBe("short");
  });

  it("ignores touching and all-day events", () => {
    expect(firstClash([e("a", 0, 1), e("b", 1, 2), e("c", 0, 24, true)])).toBeNull();
  });
});

describe("timeForEveryone", () => {
  const slots = [
    { id: "s1", startsAt: h(1) },
    { id: "s2", startsAt: h(2) },
  ];

  it("picks the time that works for everyone, most yeses first", () => {
    const answers = [
      { slotId: "s1", who: "a", availability: "IF_NEEDED" as const },
      { slotId: "s1", who: "b", availability: "YES" as const },
      { slotId: "s2", who: "a", availability: "YES" as const },
      { slotId: "s2", who: "b", availability: "YES" as const },
    ];
    expect(timeForEveryone(slots, answers)).toEqual({ slot: slots[1], people: 2 });
  });

  it("is null when nobody's time suits all, or there's one person", () => {
    expect(
      timeForEveryone(slots, [
        { slotId: "s1", who: "a", availability: "YES" },
        { slotId: "s2", who: "b", availability: "YES" },
        { slotId: "s2", who: "a", availability: "NO" },
      ]),
    ).toBeNull();
    expect(timeForEveryone(slots, [{ slotId: "s1", who: "a", availability: "YES" }])).toBeNull();
  });
});

describe("pollClosingSoon", () => {
  it("is within a day of closing, open, for whoever runs it", () => {
    const poll = { isOpen: true, canManage: true, closesAt: h(5) };
    expect(pollClosingSoon(poll, now)).toBe(true);
    expect(pollClosingSoon({ ...poll, closesAt: h(30) }, now)).toBe(false);
    expect(pollClosingSoon({ ...poll, canManage: false }, now)).toBe(false);
    expect(pollClosingSoon({ ...poll, closesAt: null }, now)).toBe(false);
  });
});
