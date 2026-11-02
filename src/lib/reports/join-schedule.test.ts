import { describe, expect, it } from "vitest";

import type { LoadedSource } from "./compute";
import { JOINED, applyJoin, joinedSummary, matchCount, readJoin } from "./join";
import { describeSchedule, isSendDay, readSchedule } from "./schedule";

const expenses: LoadedSource = {
  key: "expenses",
  kind: "expenses",
  name: "Expenses",
  icon: "ReceiptText",
  description: "",
  href: "/x",
  rows: 3,
  form: null,
  fields: [
    { id: "amount", name: "Amount", type: "CURRENCY" },
    { id: "payee", name: "Paid to", type: "TEXT" },
  ],
  members: {},
  truncated: false,
  records: [
    {
      id: "e1",
      title: "Pizza",
      values: { amount: 120, payee: "  figma " },
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
      href: null,
    },
    {
      id: "e2",
      title: "Shirts",
      values: { amount: 300, payee: "Vercel" },
      createdAt: "2026-10-02T12:00:00.000Z",
      updatedAt: "2026-10-02T12:00:00.000Z",
      href: null,
    },
    {
      id: "e3",
      title: "Room",
      values: { amount: 50 },
      createdAt: "2026-10-03T12:00:00.000Z",
      updatedAt: "2026-10-03T12:00:00.000Z",
      href: null,
    },
  ],
};

const sponsors: LoadedSource = {
  ...expenses,
  key: "custom:sp",
  kind: "custom",
  name: "Sponsors",
  fields: [
    { id: "name", name: "Name", type: "TEXT" },
    {
      id: "tier",
      name: "Tier",
      type: "SELECT",
      choices: [{ id: "g", label: "Gold", color: "yellow" }],
    },
  ],
  records: [
    {
      id: "s1",
      title: "Figma",
      values: { name: "Figma", tier: "g" },
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
      href: null,
    },
  ],
};

const join = { source: "custom:sp", field: "payee", otherField: "name" };

describe("joining a second database", () => {
  it("adds the second database's fields, named after it", () => {
    const fields = joinedSummary(expenses, sponsors, join).fields;
    expect(fields.map((f) => [f.id, f.name])).toContainEqual([`${JOINED}tier`, "Tier (Sponsors)"]);
    expect(fields.some((f) => f.id === `${JOINED}name`)).toBe(false);
  });

  it("matches rows on the shared field, ignoring case and spaces", () => {
    const joined = applyJoin(expenses, sponsors, join);
    expect(joined.records[0].values[`${JOINED}tier`]).toBe("g");
    expect(joined.records[1].values[`${JOINED}tier`]).toBeUndefined();
    expect(matchCount(joined)).toBe(1);
  });

  it("reads only a well-formed join", () => {
    expect(readJoin(join)).toEqual(join);
    expect(readJoin({ source: "nope!", field: "a", otherField: "b" })).toBeNull();
  });
});

describe("report schedules", () => {
  it("sends weekly on its weekday and monthly on its day", () => {
    const weekly = readSchedule({ every: "week", day: 1, hour: 9, to: "me" })!;
    expect(isSendDay(weekly, "2026-11-02", 1)).toBe(true);
    expect(isSendDay(weekly, "2026-11-03", 2)).toBe(false);
    const monthly = readSchedule({ every: "month", day: 15, hour: 9, to: "admins" })!;
    expect(isSendDay(monthly, "2026-11-15", 0)).toBe(true);
    expect(describeSchedule(weekly)).toBe("Every Monday at 9 AM, to you");
    expect(describeSchedule(monthly)).toBe("The 15th of every month at 9 AM, to owners and admins");
  });

  it("refuses a day that doesn't fit", () => {
    expect(readSchedule({ every: "week", day: 9, hour: 9, to: "me" })).toBeNull();
    expect(readSchedule({ every: "month", day: 0, hour: 9, to: "me" })).toBeNull();
  });
});
