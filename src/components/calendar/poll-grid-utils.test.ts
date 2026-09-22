import { describe, expect, it } from "vitest";

import {
  buildPollGrid,
  distinctRespondents,
  rankSlotsByAvailability,
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

    const grid = buildPollGrid(slots);

    expect(grid.days).toHaveLength(2);
    expect(grid.times).toHaveLength(2);
    expect(grid.cellFor(grid.days[0], grid.times[0])?.id).toBe("a");
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

  it("counts IF_NEEDED as available", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", respondentKey: "u1", availability: "IF_NEEDED" },
      { slotId: "s2", respondentKey: "u1", availability: "IF_NEEDED" },
    ];

    const ranked = rankSlotsByAvailability(slots, responses, 60);

    expect(ranked[0].score).toBe(1);
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
