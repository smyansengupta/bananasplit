import { describe, expect, it } from "vitest";

import { hashGuestKey } from "./guest-key";
import { buildPollView, type PollSource } from "./poll-view";

const slots = [
  {
    id: "slot_1",
    startsAt: new Date("2026-01-05T18:00:00.000Z"),
    endsAt: new Date("2026-01-05T18:30:00.000Z"),
  },
  {
    id: "slot_2",
    startsAt: new Date("2026-01-05T18:30:00.000Z"),
    endsAt: new Date("2026-01-05T19:00:00.000Z"),
  },
];

const hashA = hashGuestKey("a".repeat(43));
const hashB = hashGuestKey("b".repeat(43));

const poll: PollSource = {
  id: "poll_1",
  title: "Board sync",
  description: null,
  timezone: "America/New_York",
  durationMinutes: 30,
  closesAt: null,
  finalizedEventId: "event_secret",
  slots,
  responses: [
    { slotId: "slot_1", userId: "user_member_1", guestName: null, guestKeyHash: null, availability: "YES" },
    { slotId: "slot_1", userId: null, guestName: "Alex", guestKeyHash: hashA, availability: "YES" },
    { slotId: "slot_2", userId: null, guestName: "Alex", guestKeyHash: hashA, availability: "NO" },
    { slotId: "slot_1", userId: null, guestName: "alex", guestKeyHash: hashB, availability: "IF_NEEDED" },
    // A guest row from before 0A: no key, read-only.
    { slotId: "slot_2", userId: null, guestName: "Sam", guestKeyHash: null, availability: "YES" },
  ],
};

describe("buildPollView — the public poll DTO (0A Fix 6)", () => {
  it("carries no user ids, emails, key hashes or event ids for a guest", () => {
    const view = buildPollView(poll, { kind: "guest", guestKeyHash: null });
    const json = JSON.stringify(view);

    expect(json).not.toContain("user_member_1");
    expect(json).not.toContain("@");
    expect(json).not.toContain(hashA);
    expect(json).not.toContain(hashB);
    expect(json).not.toContain("event_secret");
    expect(view.isFinalized).toBe(true);
    expect(view.finalizedEventId).toBeNull();
  });

  it("keeps same-named guests apart and suffixes the duplicate name", () => {
    const view = buildPollView(poll, { kind: "guest", guestKeyHash: null });
    const labels = [...new Map(view.responses.map((r) => [r.respondentKey, r.label])).values()];

    expect(labels).toEqual(["Member", "Alex", "alex (2)", "Sam"]);
    expect(new Set(view.responses.map((r) => r.respondentKey)).size).toBe(4);
  });

  it("marks a returning guest's own answers from their key only", () => {
    const view = buildPollView(poll, { kind: "guest", guestKeyHash: hashA });

    expect(view.myResponses).toEqual({ slot_1: "YES", slot_2: "NO" });
    expect(view.myGuestName).toBe("Alex");
  });

  it("gives a guest without a key nothing of their own, legacy rows included", () => {
    const view = buildPollView(poll, { kind: "guest", guestKeyHash: null });
    expect(view.myResponses).toEqual({});
    expect(view.myGuestName).toBeNull();
  });

  it("marks a member's own answers and exposes the event link to members only", () => {
    const view = buildPollView(poll, { kind: "member", userId: "user_member_1" });
    expect(view.myResponses).toEqual({ slot_1: "YES" });
    expect(view.finalizedEventId).toBe("event_secret");
  });

  it("names members only for a member viewer given the org's names, never for a guest", () => {
    const memberNames = new Map([["user_member_1", "Alice Nguyen"]]);

    const inApp = buildPollView(poll, { kind: "member", userId: "someone_else" }, { memberNames });
    const labels = [...new Map(inApp.responses.map((r) => [r.respondentKey, r.label])).values()];
    expect(labels).toEqual(["Alice Nguyen", "Alex", "alex (2)", "Sam"]);

    const asGuest = buildPollView(poll, { kind: "guest", guestKeyHash: null }, { memberNames });
    expect(JSON.stringify(asGuest)).not.toContain("Alice");
  });

  it("gives the viewer their own respondent key, and the scheduled time to members only", () => {
    const scheduled = {
      ...poll,
      finalizedEvent: { startsAt: slots[0].startsAt, endsAt: slots[1].endsAt },
    };

    const member = buildPollView(scheduled, { kind: "member", userId: "user_member_1" });
    expect(member.myRespondentKey).toBe("r1");
    expect(member.scheduled).toEqual({ startsAt: slots[0].startsAt, endsAt: slots[1].endsAt });

    const guest = buildPollView(scheduled, { kind: "guest", guestKeyHash: hashB });
    expect(guest.myRespondentKey).toBe("r3");
    expect(guest.scheduled).toBeNull();
    expect(buildPollView(scheduled, { kind: "guest", guestKeyHash: null }).myRespondentKey).toBeNull();
  });
});
