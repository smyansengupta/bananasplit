import { describe, expect, it } from "vitest";

import { parseQuickAdd } from "./quick-add";

// Thursday, October 29 2026.
const TODAY = "2026-10-29";
const members = [
  { id: "p", name: "Priya Nair" },
  { id: "s", name: "Sam Ortiz" },
  { id: "sa", name: "Samira Holt" },
  { id: "m", name: "Maya Chen" },
];

describe("parseQuickAdd", () => {
  it("reads owner, date and leaves tags", () => {
    expect(parseQuickAdd("Order bolts @priya fri #venue", TODAY, members)).toEqual({
      title: "Order bolts #venue",
      ownerId: "p",
      ownerName: "Priya Nair",
      dueKey: "2026-10-30",
    });
  });

  it("takes a date phrase after due, by or on", () => {
    const r = parseQuickAdd("Book the room by next thu", TODAY, members);
    expect(r.title).toBe("Book the room");
    expect(r.dueKey).toBe("2026-11-05");
  });

  it("reads 'in 3 days' and 'tomorrow'", () => {
    expect(parseQuickAdd("Send recap in 3 days", TODAY, members).dueKey).toBe("2026-11-01");
    expect(parseQuickAdd("Send recap tomorrow", TODAY, members).dueKey).toBe("2026-10-30");
  });

  it("never eats the whole title", () => {
    expect(parseQuickAdd("Friday", TODAY, members)).toMatchObject({
      title: "Friday",
      dueKey: null,
    });
  });

  it("leaves an ambiguous @ in the title", () => {
    const r = parseQuickAdd("Call @sa", TODAY, members);
    expect(r.ownerId).toBeNull();
    expect(r.title).toBe("Call @sa");
  });

  it("prefers the exact first name", () => {
    expect(parseQuickAdd("Call @sam", TODAY, members).ownerId).toBe("s");
  });

  it("leaves a plain title alone", () => {
    expect(parseQuickAdd("Write the agenda", TODAY, members)).toEqual({
      title: "Write the agenda",
      ownerId: null,
      ownerName: null,
      dueKey: null,
    });
  });
});
