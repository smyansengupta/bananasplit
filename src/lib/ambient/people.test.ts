import { describe, expect, it } from "vitest";

import {
  awayDays,
  isActive,
  joinedThisWeek,
  lightestMember,
  needsATask,
  newcomerReason,
  roleFix,
  roleForSeat,
  staleInviteDays,
  tooMuchOnPlate,
} from "./people";

const NOW = new Date("2026-11-04T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("newcomers", () => {
  it("is someone who joined within the week", () => {
    expect(joinedThisWeek(daysAgo(2), NOW)).toBe(true);
    expect(joinedThisWeek(daysAgo(8), NOW)).toBe(false);
  });

  it("says when, and about the team", () => {
    expect(newcomerReason(daysAgo(2), false, NOW)).toBe("Joined 2 days ago, no team yet");
    expect(newcomerReason(daysAgo(0), true, NOW)).toBe("Joined today");
  });
});

describe("staleInviteDays", () => {
  it("waits three days from the last send", () => {
    expect(staleInviteDays(daysAgo(1), NOW)).toBeNull();
    expect(staleInviteDays(daysAgo(4), NOW)).toBe(4);
  });
});

describe("activity", () => {
  const base = { online: false, joinedAt: daysAgo(90) };

  it("Give them a task: around lately with nothing open", () => {
    expect(needsATask({ ...base, lastSeenAt: daysAgo(1), openTasks: 0 }, NOW)).toBe(true);
    expect(needsATask({ ...base, lastSeenAt: daysAgo(1), openTasks: 2 }, NOW)).toBe(false);
    expect(needsATask({ ...base, lastSeenAt: daysAgo(20), openTasks: 0 }, NOW)).toBe(false);
    expect(isActive({ ...base, online: true, lastSeenAt: null }, NOW)).toBe(true);
  });

  it("Check in: away 30 days, or never seen a month after joining", () => {
    expect(awayDays({ ...base, lastSeenAt: daysAgo(31) }, NOW)).toBe(31);
    expect(awayDays({ ...base, lastSeenAt: daysAgo(3) }, NOW)).toBeNull();
    expect(awayDays({ ...base, lastSeenAt: null }, NOW)).toBe(90);
    expect(awayDays({ online: false, joinedAt: daysAgo(5), lastSeenAt: null }, NOW)).toBeNull();
  });
});

describe("Hand one off", () => {
  it("is for eight open tasks or more", () => {
    expect(tooMuchOnPlate(7)).toBe(false);
    expect(tooMuchOnPlate(8)).toBe(true);
  });

  it("hands to whoever has the least", () => {
    const members = [
      { id: "a", name: "Ana", open: 9 },
      { id: "b", name: "Ben", open: 2 },
      { id: "c", name: "Cal", open: 2 },
    ];
    expect(lightestMember(members, "a")?.id).toBe("b");
    expect(lightestMember([{ id: "a", name: "Ana", open: 1 }], "a")).toBeNull();
  });
});

describe("Fix role", () => {
  it("reads what a seat needs", () => {
    expect(roleForSeat({ title: "Treasurer", top: false, isAdvisor: false })).toBe("TREASURER");
    expect(roleForSeat({ title: "VP Finance", top: false, isAdvisor: false })).toBe("TREASURER");
    expect(roleForSeat({ title: "President", top: true, isAdvisor: false })).toBe("ADMIN");
    expect(roleForSeat({ title: "President", top: false, isAdvisor: false })).toBeNull();
    expect(roleForSeat({ title: "Treasurer", top: false, isAdvisor: true })).toBeNull();
    expect(roleForSeat({ title: "Events lead", top: false, isAdvisor: false })).toBeNull();
  });

  it("only ever raises a role", () => {
    const treasurer = [{ title: "Treasurer", top: false, isAdvisor: false }];
    expect(roleFix("MEMBER", treasurer)).toEqual({
      to: "TREASURER",
      seat: "Treasurer",
      reason: "Holds the Treasurer seat, role is Member",
    });
    expect(roleFix("ADMIN", treasurer)).toBeNull();
    expect(roleFix("TREASURER", treasurer)).toBeNull();
    expect(roleFix("TREASURER", [{ title: "President", top: true, isAdvisor: false }])?.to).toBe(
      "ADMIN",
    );
  });
});
