// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildUpNext } from "./up-next";

/**
 * What Up next is allowed to show.
 *
 * The bug these cover: an open poll with no closing date was given a fake one
 * 30 weeks out, so it sat on the Overview for the rest of the year, and
 * nothing dropped a card once its moment had passed. "Up next" that is mostly
 * things from last month is worse than an empty one.
 */

const NOW = new Date("2026-10-25T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const ahead = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

function build(over: Partial<Parameters<typeof buildUpNext>[0]> = {}) {
  return buildUpNext({
    orgSlug: "cbc",
    now: NOW,
    todayKey: "2026-10-25",
    zones: { viewer: "UTC", org: "UTC" },
    tasks: [],
    taskExtras: new Map(),
    meetings: [],
    events: [],
    rsvps: new Map(),
    going: new Map(),
    polls: [],
    ...over,
  });
}

function poll(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: "question" as const,
    title: `Poll ${id}`,
    closesAt: null,
    createdAt: ago(1),
    voters: 1,
    eligible: 5,
    mine: false,
    faces: [],
    ...over,
  };
}

function event(id: string, startsAt: Date) {
  return {
    id,
    title: `Event ${id}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    allDay: false,
    location: null,
    kind: "OTHER" as const,
    visibility: "INTERNAL" as const,
    needsReview: false,
    googleSyncState: "NOT_APPLICABLE" as const,
  };
}

const ids = (slots: { item: { id: string } }[]) => slots.map((s) => s.item.id);

describe("what Up next shows", () => {
  it("keeps a poll asked recently that has no closing date", () => {
    expect(ids(build({ polls: [poll("fresh", { createdAt: ago(2) })] }))).toEqual(["fresh"]);
  });

  it("drops one that has been open a fortnight, rather than keeping it all year", () => {
    expect(ids(build({ polls: [poll("stale", { createdAt: ago(20) })] }))).toEqual([]);
  });

  it("drops a poll whose closing time has passed", () => {
    expect(ids(build({ polls: [poll("closed", { closesAt: ago(1) })] }))).toEqual([]);
  });

  it("keeps one closing later today", () => {
    const soon = new Date(NOW.getTime() + 3_600_000);
    expect(ids(build({ polls: [poll("soon", { closesAt: soon })] }))).toEqual(["soon"]);
  });

  it("drops an event that has already started, and keeps the one coming", () => {
    const slots = build({ events: [event("gone", ago(2)), event("coming", ahead(2))] });
    expect(ids(slots)).toEqual(["coming"]);
  });

  it("leaves a card out once its viewer has hidden it", () => {
    const polls = [poll("a"), poll("b")];
    expect(ids(build({ polls })).sort()).toEqual(["a", "b"]);
    const hidden = new Set(["poll:a"]);
    expect(ids(build({ polls, hidden }))).toEqual(["b"]);
  });

  it("hides by kind as well as id, so two things sharing an id are separate", () => {
    const polls = [poll("x")];
    const events = [event("x", ahead(1))];
    expect(ids(build({ polls, events })).length).toBe(2);
    // Hiding the poll leaves the event alone.
    const left = build({ polls, events, hidden: new Set(["poll:x"]) });
    expect(left.map((s) => s.item.kind)).toEqual(["event"]);
  });
});
