import { describe, expect, it } from "vitest";

import {
  buildPollGrid,
  distinctRespondents,
  HEAT_INK_SWITCH_PERCENT,
  HEAT_MAX_PERCENT,
  HEAT_MIN_PERCENT,
  heatPercent,
  legendSteps,
  paintRect,
  pickDistinctWindows,
  rankSlotsByAvailability,
  strokeValue,
  summarizeSlots,
  summaryFor,
  type PollResponseLite,
} from "./poll-grid-utils";

function slot(id: string, startIso: string, minutes: number) {
  const startsAt = new Date(startIso);
  return { id, startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
}

describe("buildPollGrid", () => {
  it("builds distinct sorted day and time axes from slots", () => {
    const slots = [
      slot("a", "2026-01-05T09:00:00.000Z", 30),
      slot("b", "2026-01-05T09:30:00.000Z", 30),
      slot("c", "2026-01-06T09:00:00.000Z", 30),
    ];

    const grid = buildPollGrid(slots, "UTC");

    expect(grid.days).toEqual(["2026-01-05", "2026-01-06"]);
    expect(grid.times).toEqual(["09:00", "09:30"]);
    expect(grid.cellFor(grid.days[0], grid.times[0])?.id).toBe("a");
    expect(grid.cellFor("2026-01-06", "09:30")).toBeUndefined();
    expect(grid.positionOf("c")).toEqual({ day: 1, time: 0 });
  });

  it("draws the grid in the zone it is given, not the runtime's", () => {
    // 01:00 UTC on the 6th is 20:00 on the 5th in New York.
    const slots = [slot("late", "2026-01-06T01:00:00.000Z", 30)];

    expect(buildPollGrid(slots, "America/New_York").days).toEqual(["2026-01-05"]);
    expect(buildPollGrid(slots, "America/New_York").times).toEqual(["20:00"]);
    expect(buildPollGrid(slots, "Asia/Tokyo").days).toEqual(["2026-01-06"]);
    expect(buildPollGrid(slots, "Asia/Tokyo").times).toEqual(["10:00"]);
  });
});

describe("rankSlotsByAvailability — spec 4.4 (best slots for the requested duration)", () => {
  const slots = [
    slot("s1", "2026-01-05T09:00:00.000Z", 30),
    slot("s2", "2026-01-05T09:30:00.000Z", 30),
    slot("s3", "2026-01-05T10:30:00.000Z", 30), // gap after s2 — not contiguous with it
  ];

  it("only ranks windows whose underlying slots are contiguous", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", respondentKey: "u1", availability: "YES" },
      { slotId: "s2", respondentKey: "u1", availability: "YES" },
      { slotId: "s3", respondentKey: "u1", availability: "YES" },
    ];

    // 60-minute meeting needs two consecutive 30-minute slots.
    const ranked = rankSlotsByAvailability(slots, responses, 60);

    // s1+s2 is a valid contiguous window; s3 has no following slot to pair with.
    expect(ranked.map((r) => r.slot.id)).toEqual(["s1"]);
    expect(ranked[0].slotIds).toEqual(["s1", "s2"]);
    expect(ranked[0].endsAt.toISOString()).toBe("2026-01-05T10:00:00.000Z");
  });

  it("scores a window by respondents available across every slot in it", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", respondentKey: "u1", availability: "YES" },
      { slotId: "s2", respondentKey: "u1", availability: "YES" },
      { slotId: "s1", respondentKey: "u2", availability: "YES" },
      { slotId: "s2", respondentKey: "u2", availability: "NO" },
    ];

    const ranked = rankSlotsByAvailability(slots, responses, 60);

    expect(ranked[0].score).toBe(1);
    expect(ranked[0].respondentKeys).toEqual(["u1"]);
  });

  it("counts IF_NEEDED as available, and says who only said if needed", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", respondentKey: "u1", availability: "IF_NEEDED" },
      { slotId: "s2", respondentKey: "u1", availability: "YES" },
      { slotId: "s1", respondentKey: "u2", availability: "YES" },
      { slotId: "s2", respondentKey: "u2", availability: "YES" },
    ];

    const ranked = rankSlotsByAvailability(slots, responses, 60);

    expect(ranked[0].score).toBe(2);
    expect(ranked[0].ifNeededKeys).toEqual(["u1"]);
  });
});

describe("pickDistinctWindows — a shortlist, not ten views of one afternoon", () => {
  const quarterHours = Array.from({ length: 8 }, (_, i) =>
    slot(`q${i}`, new Date(Date.UTC(2026, 0, 5, 9, i * 15)).toISOString(), 15),
  );
  const everyone = (keys: string[], ids: string[]) =>
    keys.flatMap((k) =>
      ids.map((slotId) => ({ slotId, respondentKey: k, availability: "YES" as const })),
    );

  it("skips windows that overlap a better one and drops windows nobody can make", () => {
    const responses = [
      ...everyone(["a", "b", "c"], ["q0", "q1", "q2", "q3"]),
      ...everyone(["a"], ["q4", "q5", "q6", "q7"]),
    ];
    const ranked = rankSlotsByAvailability(quarterHours, responses, 60);

    const picked = pickDistinctWindows(ranked, 5);

    expect(picked.map((w) => [w.slot.id, w.score])).toEqual([
      ["q0", 3],
      ["q4", 1],
    ]);
  });

  it("prefers a window of firm yeses over one that leans on if-needed", () => {
    const responses: PollResponseLite[] = [
      { slotId: "q0", respondentKey: "a", availability: "IF_NEEDED" },
      { slotId: "q4", respondentKey: "a", availability: "YES" },
    ];
    const ranked = rankSlotsByAvailability(quarterHours, responses, 15);

    expect(pickDistinctWindows(ranked, 1)[0].slot.id).toBe("q4");
  });

  it("returns nothing when nobody has answered", () => {
    expect(pickDistinctWindows(rankSlotsByAvailability(quarterHours, [], 60), 5)).toEqual([]);
  });
});

describe("distinctRespondents — keyed by respondent, not by name (0A Fix 6)", () => {
  it("keeps two guests with the same name apart", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", respondentKey: "r1", label: "Alex", isGuest: true, availability: "YES" },
      { slotId: "s1", respondentKey: "r2", label: "Alex (2)", isGuest: true, availability: "NO" },
      { slotId: "s2", respondentKey: "r1", label: "Alex", isGuest: true, availability: "YES" },
    ];
    expect(distinctRespondents(responses)).toEqual([
      { key: "r1", name: "Alex", isGuest: true },
      { key: "r2", name: "Alex (2)", isGuest: true },
    ]);
  });
});

describe("summarizeSlots", () => {
  it("groups each slot's answers and counts yes and if-needed as available", () => {
    const summaries = summarizeSlots([
      { slotId: "s1", respondentKey: "a", availability: "YES" },
      { slotId: "s1", respondentKey: "b", availability: "IF_NEEDED" },
    ]);

    const s1 = summaryFor(summaries, "s1");
    expect([s1.yes.length, s1.ifNeeded.length, s1.available]).toEqual([1, 1, 2]);
    expect(summaryFor(summaries, "unanswered").available).toBe(0);
  });

  it("reads a stored NO as unmarked", () => {
    const summaries = summarizeSlots([{ slotId: "s1", respondentKey: "c", availability: "NO" }]);
    expect(summaries.has("s1")).toBe(false);
  });
});

describe("the heatmap scale", () => {
  it("leaves nobody-available cells unfilled and runs one hue from the floor to the cap", () => {
    expect(heatPercent(0, 5)).toBe(0);
    expect(heatPercent(3, 0)).toBe(0);
    expect(heatPercent(5, 5)).toBe(HEAT_MAX_PERCENT);
    expect(heatPercent(1, 1000)).toBe(HEAT_MIN_PERCENT);
  });

  it("is monotonic in the number available", () => {
    const steps = Array.from({ length: 13 }, (_, n) => heatPercent(n, 12));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
  });

  it("never lands in the midtone where neither ink is readable on a dark page", () => {
    for (let total = 1; total <= 40; total++) {
      for (let n = 1; n <= total; n++) {
        const p = heatPercent(n, total);
        expect(p <= 60 || p >= HEAT_INK_SWITCH_PERCENT).toBe(true);
      }
    }
  });

  it("labels every count for small groups and five even steps for big ones", () => {
    expect(legendSteps(0)).toEqual([]);
    expect(legendSteps(3)).toEqual([0, 1, 2, 3]);
    expect(legendSteps(12)).toEqual([0, 3, 6, 9, 12]);
  });
});

describe("painting", () => {
  const grid = buildPollGrid(
    [
      slot("mon9", "2026-01-05T09:00:00.000Z", 60),
      slot("mon10", "2026-01-05T10:00:00.000Z", 60),
      slot("tue9", "2026-01-06T09:00:00.000Z", 60),
      slot("tue10", "2026-01-06T10:00:00.000Z", 60),
      slot("wed9", "2026-01-07T09:00:00.000Z", 60),
      // No Wednesday 10:00: a gap in the grid.
    ],
    "UTC",
  );

  it("fills the rectangle between two cells, from either corner", () => {
    const next = paintRect(
      { wed9: "IF_NEEDED" },
      grid,
      { day: 2, time: 1 },
      { day: 0, time: 0 },
      "YES",
    );

    expect(next).toEqual({ mon9: "YES", mon10: "YES", tue9: "YES", tue10: "YES", wed9: "YES" });
  });

  it("clears the rectangle, leaving those times unmarked", () => {
    const next = paintRect(
      { mon9: "YES", mon10: "IF_NEEDED", tue9: "YES" },
      grid,
      { day: 0, time: 0 },
      { day: 0, time: 1 },
      null,
    );

    expect(next).toEqual({ tue9: "YES" });
  });

  it("leaves the answers it started from untouched", () => {
    const base = { mon9: "IF_NEEDED" as const };
    paintRect(base, grid, { day: 0, time: 0 }, { day: 0, time: 0 }, "YES");
    paintRect(base, grid, { day: 0, time: 0 }, { day: 0, time: 0 }, null);
    expect(base).toEqual({ mon9: "IF_NEEDED" });
  });

  it("clears when the stroke starts on a cell already marked with the brush", () => {
    expect(strokeValue(undefined, "YES")).toBe("YES");
    expect(strokeValue("YES", "YES")).toBeNull();
    expect(strokeValue("IF_NEEDED", "IF_NEEDED")).toBeNull();
    expect(strokeValue("YES", "IF_NEEDED")).toBe("IF_NEEDED");
  });
});
