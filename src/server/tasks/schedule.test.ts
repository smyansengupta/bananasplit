import { describe, expect, it, vi } from "vitest";

import { weekdayOfKey, zonedInstant } from "@/lib/tasks/dates";

vi.mock("@/server/db/context", () => ({ withSystemOrgTx: vi.fn() }));
vi.mock("@/server/jobs/enqueue", () => ({ enqueueJob: vi.fn() }));

const { nextOccurrence } = await import("./schedule");
const { reminderKey, reminderRunAt } = await import("./reminders");
const { dueWhen } = await import("./email");

const NY = "America/New_York";

describe("digest and Sunday-reminder triggers", () => {
  it("hourly: only in the member's digest hour, due now", () => {
    const at8 = zonedInstant("2026-10-01", 8, NY);
    const at8late = new Date(at8.getTime() + 45 * 60_000);
    expect(nextOccurrence(at8, NY, 8, "hourly")).toEqual({ dateKey: "2026-10-01", runAt: at8 });
    expect(nextOccurrence(at8late, NY, 8, "hourly")?.dateKey).toBe("2026-10-01");
    expect(nextOccurrence(zonedInstant("2026-10-01", 7, NY), NY, 8, "hourly")).toBeNull();
    expect(nextOccurrence(zonedInstant("2026-10-01", 9, NY), NY, 8, "hourly")).toBeNull();
  });

  it("daily fallback: schedules the next occurrence within 24 hours at the local hour", () => {
    // A daily cron at 10:00 UTC (06:00 New York) schedules today's 08:00.
    const cron = new Date("2026-10-01T10:00:00Z");
    expect(nextOccurrence(cron, NY, 8, "daily")).toEqual({
      dateKey: "2026-10-01",
      runAt: zonedInstant("2026-10-01", 8, NY),
    });
    // After the hour has passed, it schedules tomorrow's.
    const late = new Date("2026-10-01T15:00:00Z");
    expect(nextOccurrence(late, NY, 8, "daily")?.dateKey).toBe("2026-10-02");
  });

  it("keys digests per local date across the DST change", () => {
    // Nov 1 2026: clocks fall back in New York. 08:00 EST is 13:00 UTC.
    const fallBack = zonedInstant("2026-11-01", 8, NY);
    expect(fallBack.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(nextOccurrence(fallBack, NY, 8, "hourly")?.dateKey).toBe("2026-11-01");
    // The day before, 08:00 EDT is 12:00 UTC; 13:00 UTC is 09:00 then, not the digest hour.
    expect(nextOccurrence(new Date("2026-10-31T13:00:00Z"), NY, 8, "hourly")).toBeNull();
  });

  it("the Sunday reminder fires only on Sunday at 18:00 local", () => {
    const sunday = (d: string) => weekdayOfKey(d) === 0;
    expect(
      nextOccurrence(zonedInstant("2026-09-27", 18, NY), NY, 18, "hourly", sunday)?.dateKey,
    ).toBe("2026-09-27");
    expect(nextOccurrence(zonedInstant("2026-09-26", 18, NY), NY, 18, "hourly", sunday)).toBeNull();
    // The daily fallback on Sunday morning schedules the evening reminder.
    expect(nextOccurrence(zonedInstant("2026-09-27", 6, NY), NY, 18, "daily", sunday)).toEqual({
      dateKey: "2026-09-27",
      runAt: zonedInstant("2026-09-27", 18, NY),
    });
  });
});

describe("reminder keys and times", () => {
  it("keys on task, due date and recipient", () => {
    expect(reminderKey("t1", "2026-10-03", "u1")).toBe("t1:2026-10-03:u1");
  });

  it("runs at 09:00 local, lead days before the due date", () => {
    expect(reminderRunAt("2026-10-03", 1, NY).toISOString()).toBe("2026-10-02T13:00:00.000Z");
    expect(reminderRunAt("2026-11-03", 2, NY).toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(reminderRunAt("2026-10-03", 0, "UTC").toISOString()).toBe("2026-10-03T09:00:00.000Z");
  });

  it("says when it's due", () => {
    expect(dueWhen("2026-10-02", "2026-10-03")).toBe("tomorrow");
    expect(dueWhen("2026-10-03", "2026-10-03")).toBe("today");
    expect(dueWhen("2026-10-01", "2026-10-04")).toBe("in 3 days");
    expect(dueWhen("2026-10-04", "2026-10-03")).toBe("yesterday (overdue)");
  });
});
