// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildRecapWeek,
  busiestLine,
  recapFindings,
  recapFoot,
  recapStats,
  recapSummary,
  runsText,
  type RecapFacts,
} from "./recap-week-text";

/**
 * The week, recapped is written from counts with templates. These pin what
 * each template says, and that a part with nothing behind it is left out
 * instead of being written as a zero.
 */

function facts(over: Partial<RecapFacts> = {}): RecapFacts {
  return {
    base: "/app/cbc",
    from: "Oct 25",
    to: "Oct 31",
    tasks: {
      done: 0,
      before: 0,
      topEpic: null,
      weekly: [0, 0, 0, 0],
      weekStarts: ["Oct 25", "Oct 18", "Oct 11", "Oct 4"],
    },
    members: { joined: 0, before: 0, people: [] },
    lastEvent: null,
    money: null,
    notes: { written: 0, before: 0, comments: 0, busiest: null },
    held: { meetings: 0, events: 0 },
    filling: null,
    atRisk: null,
    waiting: null,
    longBlocked: null,
    ...over,
  };
}

describe("busiestLine", () => {
  const starts = Array.from({ length: 12 }, (_, i) => `W${i}`);
  it("names the last week that did as well", () => {
    expect(busiestLine([23, 10, 12, 30, 5, 5], starts)).toBe(
      "The busiest week since the week of W3.",
    );
  });
  it("says how many weeks when none did", () => {
    expect(busiestLine([23, 10, 12, 11, 5], starts)).toBe("The busiest week in 5 weeks.");
  });
  it("stays quiet for a small week, a near tie with recent weeks, or little history", () => {
    expect(busiestLine([4, 1, 1, 1], starts)).toBeNull();
    expect(busiestLine([10, 12, 3, 3], starts)).toBeNull();
    expect(busiestLine([10, 3, 12, 3], starts)).toBeNull();
    expect(busiestLine([10, 1, 1], starts)).toBeNull();
  });
});

describe("recapSummary", () => {
  it("is empty for an empty week", () => {
    expect(recapSummary(facts())).toEqual([]);
  });

  it("writes tasks, the epic they were in, and who joined, with the numbers bold", () => {
    const runs = recapSummary(
      facts({
        tasks: {
          ...facts().tasks,
          done: 23,
          topEpic: { id: "e", title: "Fall Social", count: 11 },
        },
        members: { joined: 8, before: 2, people: [] },
      }),
    );
    expect(runsText(runs)).toBe(
      "The team finished 23 tasks, 11 of them in Fall Social, and 8 people joined.",
    );
    expect(runs.filter((r) => r.bold).map((r) => r.text)).toEqual(["23 tasks", "8 people joined"]);
  });

  it("leaves out an epic that isn't a real share", () => {
    const text = runsText(
      recapSummary(
        facts({
          tasks: { ...facts().tasks, done: 20, topEpic: { id: "e", title: "X", count: 3 } },
        }),
      ),
    );
    expect(text).toBe("The team finished 20 tasks.");
  });

  it("gives check-ins against RSVPs only when RSVPs are known", () => {
    const withRsvps = facts({
      lastEvent: { id: "w7", title: "Workshop 7", checkedIn: 47, rsvps: 58 },
    });
    expect(runsText(recapSummary(withRsvps))).toBe(
      "47 people checked in at Workshop 7, 81% of the 58 who RSVPed.",
    );
    const without = facts({
      lastEvent: { id: "w7", title: "Workshop 7", checkedIn: 1, rsvps: null },
    });
    expect(runsText(recapSummary(without))).toBe("1 person checked in at Workshop 7.");
  });

  it("only mentions money when the viewer can see it", () => {
    const money = { spentCents: 41_200, beforeCents: 0, period: null, transactions: 3 };
    expect(runsText(recapSummary(facts({ money })))).toBe("$412 went out.");
    expect(runsText(recapSummary(facts({ money: null })))).toBe("");
  });

  it("joins notes and comments and starts with a capital", () => {
    const text = runsText(
      recapSummary(facts({ notes: { written: 0, before: 0, comments: 31, busiest: null } })),
    );
    expect(text).toBe("31 comments left.");
    const both = runsText(
      recapSummary(facts({ notes: { written: 9, before: 2, comments: 31, busiest: null } })),
    );
    expect(both).toBe("9 notes were written and 31 comments left.");
  });
});

describe("recapStats", () => {
  it("drops every tile with nothing in it", () => {
    expect(recapStats(facts())).toEqual([]);
  });

  it("shows the change from the week before", () => {
    const [tile] = recapStats(facts({ tasks: { ...facts().tasks, done: 23, before: 14 } }));
    expect(tile).toMatchObject({
      value: "23",
      aside: "+9",
      asideTone: "up",
      sub: "14 the week before",
    });
  });

  it("writes check-ins as of RSVPs", () => {
    const [tile] = recapStats(
      facts({ lastEvent: { id: "w7", title: "Workshop 7", checkedIn: 47, rsvps: 58 } }),
    );
    expect(tile).toMatchObject({
      label: "Came to Workshop 7",
      value: "47",
      aside: "of 58",
      sub: "81% of RSVPs checked in",
    });
  });

  it("says more came than RSVPed instead of a share past 100%", () => {
    const f = facts({ lastEvent: { id: "w7", title: "Workshop 7", checkedIn: 14, rsvps: 10 } });
    expect(recapStats(f)[0]).toMatchObject({ value: "14", aside: null, sub: "More than RSVPed" });
    expect(runsText(recapSummary(f))).toBe(
      "14 people checked in at Workshop 7, more than the 10 who RSVPed.",
    );
  });

  it("puts spending against the budget period", () => {
    const [tile] = recapStats(
      facts({
        money: {
          spentCents: 41_200,
          beforeCents: 10_000,
          transactions: 4,
          period: { id: "p", label: "Fall", spentCents: 214_000, allocatedCents: 350_000 },
        },
      }),
    );
    expect(tile).toMatchObject({ value: "$412", sub: "$2,140 of $3,500 this budget period" });
  });
});

describe("recapFindings", () => {
  it("finds nothing in a quiet week", () => {
    expect(recapFindings(facts())).toEqual([]);
  });

  it("prefers an event filling faster than the last one", () => {
    const [good] = recapFindings(
      facts({
        filling: {
          event: { id: "w8", title: "Workshop 8" },
          rsvps: 41,
          daysOut: 4,
          prior: { id: "w7", title: "Workshop 7", atThisPoint: 29, final: 58 },
        },
      }),
    );
    expect(good.tone).toBe("good");
    expect(good.text).toBe(
      "Workshop 8 has 41 RSVPs four days out. Workshop 7 had 29 at this point and ended at 58.",
    );
    expect(good.chips.map((c) => c.href)).toEqual(["/app/cbc/meetings/w8", "/app/cbc/meetings/w7"]);
  });

  it("isn't going well when it's filling slower", () => {
    const out = recapFindings(
      facts({
        filling: {
          event: { id: "w8", title: "Workshop 8" },
          rsvps: 10,
          daysOut: 4,
          prior: { id: "w7", title: "Workshop 7", atThisPoint: 29, final: 58 },
        },
      }),
    );
    expect(out).toEqual([]);
  });

  it("flags an event this week with blocked tasks", () => {
    const [risk] = recapFindings(
      facts({
        atRisk: {
          event: { id: "fs", title: "Fall Social", daysOut: 6 },
          blocked: [{ id: "t1", title: "Order pizza" }],
          open: 2,
        },
      }),
    );
    expect(risk.tone).toBe("risk");
    expect(risk.text).toBe(
      "Fall Social is in 6 days. Order pizza is blocked, and 2 other tasks are still open.",
    );
    expect(risk.chips.map((c) => c.kind)).toEqual(["event", "task"]);
  });

  it("calls reimbursements waiting over 10 days stuck, with the task they block", () => {
    const [stuck] = recapFindings(
      facts({
        waiting: {
          count: 2,
          people: [{ id: "u1", name: "Alex Green" }],
          blockedTask: { id: "t1", title: "the pizza order" },
        },
      }),
    );
    expect(stuck.text).toBe(
      "Two reimbursements have waited over 10 days, and the pizza order is blocked on one of them.",
    );
    expect(stuck.chips.map((c) => c.label)).toEqual([
      "2 reimbursements",
      "the pizza order",
      "Alex Green",
    ]);
  });

  it("falls back to the longest-blocked task when there's no money to show", () => {
    const [stuck] = recapFindings(
      facts({ longBlocked: { id: "t", title: "Book the room", days: 9 } }),
    );
    expect(stuck.text).toBe("Book the room has been blocked for 9 days.");
  });
});

describe("recapFoot and the text", () => {
  it("lists only what it was written from", () => {
    expect(recapFoot(facts())).toBeNull();
    expect(
      recapFoot(
        facts({
          tasks: { ...facts().tasks, done: 23 },
          held: { meetings: 4, events: 2 },
          notes: { written: 9, before: 0, comments: 0, busiest: null },
        }),
      ),
    ).toBe("Written from 23 tasks, 4 meetings, 9 notes and 2 events.");
  });

  it("copies as text with the summary, the tiles and the findings", () => {
    const recap = buildRecapWeek(
      facts({
        tasks: { ...facts().tasks, done: 5, before: 1 },
        longBlocked: { id: "t", title: "Book the room", days: 9 },
      }),
    );
    expect(recap.title).toBe("The week, recapped: Oct 25 to Oct 31");
    expect(recap.text).toBe(
      [
        "The team finished 5 tasks.",
        "Tasks done: 5 (+4), 1 the week before",
        "Going well: The team finished 5 tasks, up from 1 the week before.\nStuck: Book the room has been blocked for 9 days.",
      ].join("\n\n"),
    );
  });
});
