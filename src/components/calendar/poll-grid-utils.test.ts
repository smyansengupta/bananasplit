import { describe, expect, it } from "vitest";

import { buildPollGrid, rankSlotsByAvailability, type PollResponseLite } from "./poll-grid-utils";

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
      { slotId: "s1", userId: "u1", guestName: null, availability: "YES" },
      { slotId: "s2", userId: "u1", guestName: null, availability: "YES" },
      { slotId: "s3", userId: "u1", guestName: null, availability: "YES" },
    ];

    // 60-minute meeting needs two consecutive 30-minute slots.
    const ranked = rankSlotsByAvailability(slots, responses, 60);

    // s1+s2 is a valid contiguous window; s3 has no following slot to pair with.
    expect(ranked.map((r) => r.slot.id)).toEqual(["s1"]);
  });

  it("scores a window by respondents available across every slot in it", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", userId: "u1", guestName: null, availability: "YES" },
      { slotId: "s2", userId: "u1", guestName: null, availability: "YES" },
      { slotId: "s1", userId: "u2", guestName: null, availability: "YES" },
      { slotId: "s2", userId: "u2", guestName: null, availability: "NO" },
    ];

    const ranked = rankSlotsByAvailability(slots, responses, 60);

    expect(ranked[0].score).toBe(1);
    expect(ranked[0].respondentKeys).toEqual(["u1"]);
  });

  it("counts IF_NEEDED as available", () => {
    const responses: PollResponseLite[] = [
      { slotId: "s1", userId: "u1", guestName: null, availability: "IF_NEEDED" },
      { slotId: "s2", userId: "u1", guestName: null, availability: "IF_NEEDED" },
    ];

    const ranked = rankSlotsByAvailability(slots, responses, 60);

    expect(ranked[0].score).toBe(1);
  });
});
