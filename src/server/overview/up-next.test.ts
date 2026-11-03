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
    meetingType: null,
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

  it("drops an event that has already ended, and keeps the one coming", () => {
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

  it("says why each card matters and chips what it's linked to", () => {
    const social = { ...event("social", ahead(2)), title: "Fall Social" };
    const meeting = { ...event("sync", ahead(1)), title: "Exec sync" };
    const tasks = [
      {
        id: "t1",
        title: "Order pizza",
        status: "NOT_STARTED" as const,
        visibility: "ORG" as const,
        dueDate: new Date("2026-10-27T00:00:00Z"),
        blockedReason: null,
        parentTask: null,
      },
    ];
    const chip = (kind: "event" | "note", id: string, label: string) => ({
      kind: kind === "event" ? ("event" as const) : ("note" as const),
      label,
      href: `/app/cbc/x/${id}`,
      ref: { kind, id },
    });
    const slots = build({
      tasks: tasks as never,
      events: [social],
      meetings: [meeting],
      context: {
        links: new Map([["task:t1", [chip("event", "social", "Fall Social")]]]),
        details: new Map([
          [
            "sync",
            {
              id: "sync",
              description: "- Budget\n- Room",
              seriesId: "s",
              rsvpEnabled: false,
              capacity: null,
              hideCount: false,
              notes: [{ id: "n1", title: "Exec notes" }],
            },
          ],
          [
            "social",
            {
              id: "social",
              description: null,
              seriesId: null,
              rsvpEnabled: true,
              capacity: 120,
              hideCount: false,
              notes: [],
            },
          ],
        ]),
        lastActions: new Map([["sync", { open: 2, total: 6, href: "/app/cbc/meetings/last" }]]),
        seats: new Map([["social", 58]]),
      },
    });
    const card = (id: string) => slots.find((s) => s.item.id === id)!.item;
    expect(card("t1").subtitle).toBe("For Fall Social, Tue, 12:00 PM.");
    expect(card("t1").chips?.map((c) => c.label)).toEqual(["Fall Social"]);
    expect(card("sync").subtitle).toBe(
      "2 agenda items. 2 action items from last time are still open.",
    );
    expect(card("sync").chips?.map((c) => c.label)).toEqual(["Exec notes", "2 open actions"]);
    expect(card("social").subtitle).toBe("58 of 120 seats taken.");
  });
});

describe("an event's life on Up next", () => {
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
  const only = (over: Partial<Parameters<typeof buildUpNext>[0]>) => build(over)[0]?.item;

  it("counts down in its last hour, without going live yet", () => {
    const card = only({ events: [event("w8", min(45))] });
    expect(card?.kicker).toBe("In 45 min");
    expect(card?.live).toBeUndefined();
  });

  it("goes live a quarter of an hour before it starts", () => {
    const card = only({ events: [event("w8", min(10))] });
    expect(card?.kicker).toBe("In 10 min");
    expect(card?.live).toBe("soon");
  });

  it("stays while it's happening, live", () => {
    const card = only({ events: [{ ...event("w8", min(-20)), location: "Richards Hall 300" }] });
    expect(card?.kicker).toBe("Happening now, Richards Hall 300");
    expect(card?.live).toBe("now");
  });

  it("says it just ended for two hours after, with what to add while it's fresh", () => {
    const ended = { ...event("sync", min(-90)), title: "Weekly exec sync meeting" };
    const card = only({ ended: [ended] });
    expect(card?.kicker).toBe("Just ended");
    expect(card?.ended).toBe(true);
    expect(card?.href).toBe("/app/cbc/meetings/sync");
    expect(card?.subtitle).toMatch(/notes and action items/);
  });

  it("keeps an all-day event plain: no countdown and never live", () => {
    const card = only({ events: [{ ...event("fair", min(30)), allDay: true }] });
    expect(card?.live).toBeUndefined();
    expect(card?.kicker).not.toMatch(/^In /);
  });

  it("takes over two columns on event day, with check-ins against RSVPs, and leaves room for two more", () => {
    const live = event("w8", min(-20));
    const slots = build({
      events: [live, event("later", min(600)), event("next", min(900)), event("after", min(1200))],
      context: { turnout: new Map([["w8", { rsvps: 38, checkIns: 31 }]]) },
    });
    const card = slots[0]?.item;
    expect(card?.wide).toBe(true);
    expect(card?.figure).toBe("31");
    expect(card?.figureLabel).toBe("checked in, of 38 RSVPs");
    expect(slots).toHaveLength(3);
  });

  it("shows an event's turnout once it's over", () => {
    const card = only({
      ended: [event("w8", min(-120))],
      context: { turnout: new Map([["w8", { rsvps: 38, checkIns: 33 }]]) },
    });
    expect(card?.figure).toBe("33");
    expect(card?.figureLabel).toBe("came, of 38 who said yes");
  });
});
