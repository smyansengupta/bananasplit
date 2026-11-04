import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", () => ({ withSystemOrgTx: vi.fn() }));
vi.mock("@/server/jobs/enqueue", () => ({ enqueueJob: vi.fn() }));

const { previousPulseSend, pulseSendFor, pulseWeekStartHolding, upcomingPulseSend } = await import(
  "./schedule"
);

/**
 * The pulse's time math: the send day and hour in the club's own zone,
 * across daylight-saving changes, in both trigger modes, and the week each
 * send covers (the seven days ending on the send day).
 */

const NY = "America/New_York";
const FRIDAY = 5;
const SUNDAY = 0;

describe("pulseSendFor (hourly)", () => {
  it("fires in the organization's 5pm hour on its day, and not an hour either side", () => {
    // Fri Oct 9 2026, 5:20pm EDT = 21:20Z.
    const send = pulseSendFor(new Date("2026-10-09T21:20:00Z"), NY, FRIDAY, 17, "hourly");
    expect(send).toMatchObject({ sendKey: "2026-10-09", weekStart: "2026-10-03" });
    expect(pulseSendFor(new Date("2026-10-09T20:20:00Z"), NY, FRIDAY, 17, "hourly")).toBeNull();
    expect(pulseSendFor(new Date("2026-10-09T22:20:00Z"), NY, FRIDAY, 17, "hourly")).toBeNull();
    // Thursday at 5pm: wrong day.
    expect(pulseSendFor(new Date("2026-10-08T21:20:00Z"), NY, FRIDAY, 17, "hourly")).toBeNull();
  });

  it("follows the clock through the end of daylight saving (Sun Nov 1, 2026)", () => {
    // Before: Sun Oct 25 5pm EDT is 21:00Z. After: Sun Nov 1 5pm EST is 22:00Z.
    expect(pulseSendFor(new Date("2026-10-25T21:05:00Z"), NY, SUNDAY, 17, "hourly")).not.toBeNull();
    expect(pulseSendFor(new Date("2026-11-01T21:05:00Z"), NY, SUNDAY, 17, "hourly")).toBeNull();
    expect(
      pulseSendFor(new Date("2026-11-01T22:05:00Z"), NY, SUNDAY, 17, "hourly"),
    ).toMatchObject({ sendKey: "2026-11-01", weekStart: "2026-10-26" });
  });
});

describe("pulseSendFor (daily)", () => {
  it("schedules the send within the next 24 hours at its exact local time", () => {
    const send = pulseSendFor(new Date("2026-10-09T06:00:00Z"), NY, FRIDAY, 17, "daily");
    expect(send?.runAt.toISOString()).toBe("2026-10-09T21:00:00.000Z");
    expect(send?.weekStart).toBe("2026-10-03");
    // Two days out: not this trigger's.
    expect(pulseSendFor(new Date("2026-10-07T06:00:00Z"), NY, FRIDAY, 17, "daily")).toBeNull();
  });

  it("uses the spring-forward offset when the send lands just after it (Sun Mar 8, 2026)", () => {
    const send = pulseSendFor(new Date("2026-03-08T05:00:00Z"), NY, SUNDAY, 9, "daily");
    // 9am EDT (UTC-4) on the day the clocks go forward.
    expect(send?.runAt.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("works east of UTC, where the local day starts the evening before", () => {
    // Tokyo Saturday 8am = Friday 23:00Z.
    const send = pulseSendFor(new Date("2026-10-09T12:00:00Z"), "Asia/Tokyo", 6, 8, "daily");
    expect(send).toMatchObject({ sendKey: "2026-10-10", weekStart: "2026-10-04" });
    expect(send?.runAt.toISOString()).toBe("2026-10-09T23:00:00.000Z");
  });
});

describe("upcoming and previous sends", () => {
  it("is this week's send until it passes, then next week's", () => {
    const before = upcomingPulseSend(new Date("2026-10-09T20:59:00Z"), NY, FRIDAY, 17);
    expect(before.sendKey).toBe("2026-10-09");
    const after = upcomingPulseSend(new Date("2026-10-09T21:01:00Z"), NY, FRIDAY, 17);
    expect(after.sendKey).toBe("2026-10-16");
    expect(previousPulseSend(new Date("2026-10-12T12:00:00Z"), NY, FRIDAY, 17)).toMatchObject({
      sendKey: "2026-10-09",
      weekStart: "2026-10-03",
    });
  });

  it("groups days into the week ending on the pulse day", () => {
    expect(pulseWeekStartHolding("2026-10-09", FRIDAY)).toBe("2026-10-03"); // Fri
    expect(pulseWeekStartHolding("2026-10-10", FRIDAY)).toBe("2026-10-10"); // Sat starts the next
    expect(pulseWeekStartHolding("2026-10-11", SUNDAY)).toBe("2026-10-05"); // Mon to Sun
  });
});
