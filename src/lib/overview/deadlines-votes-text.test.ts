// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDeadlines, deadlineTag, type DeadlineItem } from "./deadlines-text";
import { buildVotes, leaderLine, type VoteFact } from "./votes-text";

/**
 * Deadlines and Votes: date tags, the warning for something close and not
 * started, turnout and who's ahead, and the line about a vote you haven't
 * cast. Nothing is shown that the data doesn't hold (no quorum, no "of"
 * for an election's unknown electorate).
 */

const TODAY = "2026-11-01"; // a Sunday
const NOW = new Date("2026-11-01T15:00:00Z");

function item(over: Partial<DeadlineItem>): DeadlineItem {
  return {
    key: "k",
    kind: "task",
    dayKey: "2026-11-04",
    title: "Confirm the speaker",
    source: "Task, yours",
    href: "/app/cbc/tasks/t",
    notStarted: false,
    ...over,
  };
}

describe("Deadlines", () => {
  it("tags this week by weekday and later by date", () => {
    expect(deadlineTag("2026-11-01", TODAY)).toBe("Today");
    expect(deadlineTag("2026-11-02", TODAY)).toBe("Tmrw");
    expect(deadlineTag("2026-11-04", TODAY)).toBe("Wed");
    expect(deadlineTag("2026-11-08", TODAY)).toBe("Nov 8");
  });

  it("sorts by date and warns about the soonest one not started", () => {
    const out = buildDeadlines(
      [
        item({ key: "b", dayKey: "2026-11-12", title: "Room request" }),
        item({ key: "a", dayKey: "2026-11-06", title: "Confirm the speaker", notStarted: true }),
        item({
          key: "c",
          dayKey: "2026-11-04",
          kind: "form",
          title: "Hackathon sign-ups close",
          source: "Form, 18 of 40",
        }),
      ],
      TODAY,
    );
    expect(out.rows.map((r) => [r.key, r.tag, r.tone])).toEqual([
      ["c", "Wed", "soon"],
      ["a", "Fri", "warn"],
      ["b", "Nov 12", "later"],
    ]);
    expect(out.insight).toBe("Confirm the speaker is due Fri and isn't started.");
  });

  it("doesn't warn about something not started weeks out", () => {
    const out = buildDeadlines([item({ dayKey: "2026-11-15", notStarted: true })], TODAY);
    expect(out.insight).toBeNull();
  });

  it("words a form with no answers", () => {
    const out = buildDeadlines(
      [item({ kind: "form", title: "Applications close", dayKey: "2026-11-02", notStarted: true })],
      TODAY,
    );
    expect(out.insight).toBe("Applications close tomorrow with no answers yet.");
  });

  it("keeps the warned one when the list is cut short", () => {
    const many = Array.from({ length: 8 }, (_, i) => item({ key: `k${i}`, dayKey: "2026-11-02" }));
    const out = buildDeadlines(
      [...many, item({ key: "w", dayKey: "2026-11-03", notStarted: true })],
      TODAY,
      6,
    );
    expect(out.rows).toHaveLength(6);
    expect(out.rows.some((r) => r.key === "w" && r.tone === "warn")).toBe(true);
    expect(out.total).toBe(9);
  });
});

function vote(over: Partial<VoteFact>): VoteFact {
  return {
    key: "v",
    kind: "poll",
    title: "Hackathon date",
    href: "/app/cbc/forms/polls/p",
    closesAt: new Date("2026-11-02T20:00:00Z"),
    voters: 7,
    eligible: 48,
    mine: false,
    options: null,
    ...over,
  };
}

describe("Votes", () => {
  it("says who leads, or that it's tied", () => {
    expect(
      leaderLine([
        { label: "Dec 5", votes: 4 },
        { label: "Dec 6", votes: 3 },
      ]),
    ).toBe("Dec 5 leads, 4 to 3");
    expect(
      leaderLine([
        { label: "A", votes: 2 },
        { label: "B", votes: 2 },
      ]),
    ).toBe("A and B are tied at 2");
    expect(
      leaderLine([
        { label: "A", votes: 0 },
        { label: "B", votes: 0 },
      ]),
    ).toBeNull();
    expect(leaderLine(null)).toBeNull();
  });

  it("gives turnout as a share only when who can vote is known", () => {
    const out = buildVotes(
      [
        vote({ key: "p", voters: 31, eligible: 48, mine: true }),
        vote({
          key: "e",
          kind: "election",
          voters: 31,
          eligible: null,
          mine: null,
          closesAt: null,
        }),
      ],
      NOW,
      "UTC",
    );
    expect(out.cards.map((c) => [c.key, c.percent, c.closes])).toEqual([
      ["p", 65, "Closes tomorrow"],
      ["e", null, null],
    ]);
  });

  it("reminds you of a vote you haven't cast that closes soon", () => {
    const out = buildVotes([vote({})], NOW, "UTC");
    expect(out.insight).toBe("You haven't voted on Hackathon date yet. It closes tomorrow.");
  });

  it("otherwise points at low turnout with a week left, and never invents a quorum", () => {
    const out = buildVotes(
      [vote({ mine: true, closesAt: new Date("2026-11-06T20:00:00Z") })],
      NOW,
      "UTC",
    );
    expect(out.insight).toBe("Hackathon date has 7 of 48 votes and closes Fri.");
    expect(buildVotes([vote({ mine: null, eligible: null })], NOW, "UTC").insight).toBeNull();
  });
});
