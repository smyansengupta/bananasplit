import { describe, expect, it } from "vitest";

import { ambientLayout } from "./ambient";
import { isNight, scoreHome, type HomeSignals } from "./priority";
import { resolveOverview } from "./widgets";

/**
 * The twelve states on the Home canvas ("Ambient Home, twelve states"),
 * each as signals, and what leads the board in it.
 */

const calm: HomeSignals = {
  hour: 14,
  weekday: 3,
  role: "MEMBER",
  meeting: null,
  meetingJustEnded: null,
  event: null,
  overdue: 0,
  dueToday: 0,
  tomorrowNotStarted: null,
  deadlinesToday: 0,
  waiting: { count: 0, requests: 0 },
  voteClosing: null,
  formsClosing: 0,
  decisions: 0,
  changes: 0,
  daysAway: 0,
  othersOnline: 0,
  week: { events: 0, due: 0, meetings: 0 },
};

const home = [
  ...resolveOverview(null, true),
  { id: "waiting-on-you", type: "waiting-on-you", w: 2, h: 1 },
  { id: "decisions", type: "decisions", w: 2, h: 1 },
];

function board(over: Partial<HomeSignals>, resting: string[] = []) {
  const s = { ...calm, ...over };
  return ambientLayout(home, {
    resting: new Set(resting),
    compact: new Set(),
    scores: scoreHome(s),
    night: isNight(s.hour),
  });
}

/** The lead row as "type:span", or null when nothing leads. */
function lead(over: Partial<HomeSignals>, resting?: string[]) {
  const row = board(over, resting).rows[0];
  return row?.band === "lead" ? row.items.map((i) => `${i.widget.type}:${i.span}`) : null;
}

const why = (over: Partial<HomeSignals>) => board(over).rows[0]?.items[0]?.lead;

describe("Ambient Home, twelve states", () => {
  it("Monday morning: the week ahead leads", () => {
    const s = { weekday: 1, hour: 9, week: { events: 3, due: 1, meetings: 0 } };
    expect(lead(s)).toEqual(["week:5", "my-tasks:3"]);
    expect(why(s)).toBe("The week ahead: 3 events, 1 due");
  });

  it("a deadline tomorrow: Deadlines takes the first slot", () => {
    expect(lead({ tomorrowNotStarted: "Submit SAO funding application" })).toEqual([
      "deadlines:5",
      "my-tasks:3",
    ]);
    expect(why({ tomorrowNotStarted: "x" })).toBe("Due tomorrow, not started");
  });

  it("fifteen minutes before a meeting: Meetings and Here now lead together", () => {
    const s = {
      meeting: { title: "Weekly exec sync", startsInMin: 12, underWay: false },
      othersOnline: 2,
    };
    expect(lead(s)).toEqual(["meetings:5", "here-now:3"]);
    expect(why(s)).toBe("Starts in 12 min");
  });

  it("event day, during: Events leads with its check-ins", () => {
    const s = { event: { title: "Workshop 8", startsInMin: -40, underWay: true, checkIns: 31 } };
    expect(lead(s)?.[0]).toBe("events:5");
    expect(why(s)).toBe("Happening now, 31 checked in");
  });

  it("back after five days: the catch-up story leads, across the row", () => {
    expect(lead({ changes: 34, daysAway: 5 })).toEqual(["since-you-were-here:8"]);
    expect(why({ changes: 34, daysAway: 5 })).toBe("34 changes in 5 days");
  });

  it("approvals piling up for a treasurer: Waiting on you leads", () => {
    const s = { role: "TREASURER", waiting: { count: 4, requests: 4 } };
    expect(lead(s)?.[0]).toBe("waiting-on-you:5");
    expect(why(s)).toBe("4 reimbursements to approve");
  });

  it("a vote closing soon that you haven't answered: Votes moves up", () => {
    expect(lead({ voteClosing: "Hackathon date" })?.[0]).toBe("votes:5");
  });

  it("Friday afternoon: the week's wrap leads, across the row", () => {
    expect(lead({ weekday: 5, hour: 15 })).toEqual(["weekly-pulse:8"]);
  });

  it("a quiet day: nothing leads, everything keeps its usual spot", () => {
    const quiet = board({}, ["since-you-were-here", "votes", "meetings"]);
    expect(quiet.rows[0].band).toBe("you");
    expect(quiet.resting.map((w) => w.type)).toEqual(["since-you-were-here", "meetings", "votes"]);
  });

  it("late at night: only what matters stays, the rest rests until morning", () => {
    const night = board({ hour: 23, overdue: 1 });
    const shown = night.rows.flatMap((r) => r.items.map((i) => i.widget.type));
    expect(shown).toEqual(["my-tasks"]);
    expect(night.resting.length).toBeGreaterThan(5);
  });

  it("a new organization: nothing on the board pretends to lead (setup heads the page)", () => {
    expect(lead({})).toBeNull();
  });

  it("just after a meeting: Meetings leads with its wrap-up", () => {
    const s = { meetingJustEnded: { title: "Weekly exec sync" } };
    expect(lead(s)?.[0]).toBe("meetings:5");
    expect(why(s)).toBe("Weekly exec sync just ended: add the notes");
  });
});

describe("the rules", () => {
  it("a third widget at 75 or more goes first in its own band", () => {
    const rows = board({
      meeting: { title: "Sync", startsInMin: 5, underWay: false },
      othersOnline: 3,
      tomorrowNotStarted: "Funding",
    }).rows;
    expect(rows[0].items.map((i) => i.widget.type)).toEqual(["meetings", "here-now"]);
    const calendar = rows.find((r) => r.band === "calendar");
    expect(calendar?.items[0].widget.type).toBe("deadlines");
  });

  it("only the widgets that lead carry a reason; My tasks beside them doesn't", () => {
    const [row] = board({ tomorrowNotStarted: "Funding" }).rows;
    expect(row.items.map((i) => i.lead ?? null)).toEqual(["Due tomorrow, not started", null]);
  });

  it("a role adds to the score: an owner's decisions lead, a member's don't", () => {
    expect(lead({ role: "OWNER", decisions: 2 })?.[0]).toBe("decisions:5");
    expect(scoreHome({ ...calm, decisions: 2 }).get("decisions")?.score).toBe(45);
  });

  it("every band still adds up to eight columns", () => {
    for (const r of board({ tomorrowNotStarted: "x" }).rows) {
      expect(r.items.reduce((n, i) => n + i.span, 0)).toBe(8);
    }
  });
});
