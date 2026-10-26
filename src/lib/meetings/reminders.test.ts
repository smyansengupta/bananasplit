import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  MAX_REMINDERS,
  REMINDER_CHOICES,
  reminderLabel,
  reminderLead,
  reminderOffsetsSchema,
} from "./reminders";

/**
 * Reminder offsets: how many minutes before a meeting a reminder goes out
 * (docs/features/meetings.md). The schema mirrors the database's
 * app.reminder_offsets_ok (at most 8, each 1-40320, no duplicates), so a bad
 * list is refused with a sentence rather than a constraint violation.
 */

describe("the limits", () => {
  it("are the ones the database enforces", () => {
    expect(MAX_REMINDERS).toBe(8);
    expect(MAX_REMINDER_MINUTES).toBe(40320);
  });

  it("start a meeting with a day's notice and an hour's", () => {
    expect(DEFAULT_REMINDER_MINUTES).toEqual([1440, 60]);
  });

  it("offer the picker a week, two days, a day, two hours, an hour, half an hour and ten minutes", () => {
    expect(REMINDER_CHOICES).toEqual([10080, 2880, 1440, 120, 60, 30, 10]);
  });

  it("offer only choices the schema accepts, and never the same one twice", () => {
    expect(reminderOffsetsSchema.safeParse([...REMINDER_CHOICES]).success).toBe(true);
    expect(new Set(REMINDER_CHOICES).size).toBe(REMINDER_CHOICES.length);
  });
});

describe("reminderOffsetsSchema", () => {
  it("puts the earliest reminder first, whatever order it arrives in", () => {
    expect(reminderOffsetsSchema.parse([60, 1440])).toEqual([1440, 60]);
    expect(reminderOffsetsSchema.parse([10, 10080, 60, 2880])).toEqual([10080, 2880, 60, 10]);
  });

  it("leaves a list that is already in order as it is", () => {
    expect(reminderOffsetsSchema.parse([1440, 60])).toEqual([1440, 60]);
  });

  it("hands back a plain array, not the caller's own", () => {
    const given = [60, 1440];
    const parsed = reminderOffsetsSchema.parse(given);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).not.toBe(given);
    expect(given).toEqual([60, 1440]);
  });

  it("accepts no reminders at all", () => {
    expect(reminderOffsetsSchema.parse([])).toEqual([]);
  });

  it("accepts the edges: one minute, four weeks, and eight reminders", () => {
    expect(reminderOffsetsSchema.parse([1])).toEqual([1]);
    expect(reminderOffsetsSchema.parse([40320])).toEqual([40320]);
    const eight = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(reminderOffsetsSchema.parse(eight)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("refuses nine reminders", () => {
    const result = reminderOffsetsSchema.safeParse([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at most 8/i);
  });

  it("refuses 0 minutes", () => {
    expect(reminderOffsetsSchema.safeParse([0]).success).toBe(false);
    expect(reminderOffsetsSchema.safeParse([60, 0]).success).toBe(false);
  });

  it("refuses a negative number of minutes", () => {
    expect(reminderOffsetsSchema.safeParse([-60]).success).toBe(false);
  });

  it("refuses more than four weeks", () => {
    expect(reminderOffsetsSchema.safeParse([40321]).success).toBe(false);
  });

  it("refuses a fraction of a minute", () => {
    expect(reminderOffsetsSchema.safeParse([1.5]).success).toBe(false);
  });

  it("refuses the same time twice", () => {
    const result = reminderOffsetsSchema.safeParse([60, 60]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/once/i);
  });

  it("refuses things that are not numbers", () => {
    expect(reminderOffsetsSchema.safeParse(["60"]).success).toBe(false);
    expect(reminderOffsetsSchema.safeParse([null]).success).toBe(false);
    expect(reminderOffsetsSchema.safeParse(60).success).toBe(false);
    expect(reminderOffsetsSchema.safeParse(null).success).toBe(false);
  });
});

describe("reminderLabel", () => {
  it.each([
    [10, "10 minutes before"],
    [60, "1 hour before"],
    [120, "2 hours before"],
    [90, "90 minutes before"],
    [1440, "1 day before"],
    [2880, "2 days before"],
    [10080, "1 week before"],
  ])("%i minutes is %j", (minutes, label) => {
    expect(reminderLabel(minutes)).toBe(label);
  });

  it("is singular for one of anything", () => {
    expect(reminderLabel(1)).toBe("1 minute before");
  });

  it("uses whole weeks, then days, then hours, then minutes", () => {
    expect(reminderLabel(20160)).toBe("2 weeks before");
    expect(reminderLabel(40320)).toBe("4 weeks before");
    expect(reminderLabel(4320)).toBe("3 days before");
    expect(reminderLabel(180)).toBe("3 hours before");
    expect(reminderLabel(1)).toBe("1 minute before");
    expect(reminderLabel(45)).toBe("45 minutes before");
  });

  it("does not round to a unit it does not fill", () => {
    // An hour and a half is not "1.5 hours"; a day and a half is not "36 hours".
    expect(reminderLabel(90)).toBe("90 minutes before");
    expect(reminderLabel(2160)).toBe("36 hours before");
    expect(reminderLabel(1500)).toBe("25 hours before");
    expect(reminderLabel(10090)).toBe("10090 minutes before");
  });
});

describe("reminderLead", () => {
  it.each([
    [10, "in 10 minutes"],
    [60, "in an hour"],
    [120, "in 2 hours"],
    [1440, "tomorrow"],
    [2880, "in 2 days"],
    [10080, "in a week"],
    [90, "in 90 minutes"],
  ])("%i minutes is %j", (minutes, lead) => {
    expect(reminderLead(minutes)).toBe(lead);
  });

  it("is singular for one minute", () => {
    expect(reminderLead(1)).toBe("in a minute");
  });

  it("uses whole weeks, then days, then hours, then minutes", () => {
    expect(reminderLead(20160)).toBe("in 2 weeks");
    expect(reminderLead(40320)).toBe("in 4 weeks");
    expect(reminderLead(4320)).toBe("in 3 days");
    expect(reminderLead(180)).toBe("in 3 hours");
    expect(reminderLead(45)).toBe("in 45 minutes");
  });

  it("does not round to a unit it does not fill", () => {
    expect(reminderLead(2160)).toBe("in 36 hours");
    expect(reminderLead(10090)).toBe("in 10090 minutes");
  });
});
