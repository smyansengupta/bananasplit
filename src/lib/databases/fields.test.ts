import { describe, expect, it } from "vitest";

import {
  choicesFromValues,
  choicesVersion,
  convertValue,
  displayText,
  inferFieldType,
  parseCell,
  parseDateInput,
  type FieldDef,
  type FieldType,
} from "./fields";
import { DATABASE_TEMPLATES } from "./templates";

const field = (type: FieldType, options: FieldDef["options"] = {}) => ({ type, options });
const ok = (value: unknown) => ({ ok: true, value });

describe("parseCell: what each field type stores", () => {
  it("treats empty input as an empty cell, whatever the type", () => {
    for (const t of ["TEXT", "NUMBER", "DATE", "SELECT", "EMAIL"] as const) {
      expect(parseCell(field(t), "  ")).toEqual(ok(null));
      expect(parseCell(field(t), null)).toEqual(ok(null));
    }
  });

  it("text: one line for TEXT, paragraphs kept for LONG_TEXT, length capped", () => {
    expect(parseCell(field("TEXT"), "  Maya \n Patel ")).toEqual(ok("Maya Patel"));
    expect(parseCell(field("LONG_TEXT"), "Line one\nLine two  ")).toEqual(ok("Line one\nLine two"));
    expect(parseCell(field("TEXT"), "x".repeat(1001)).ok).toBe(false);
  });

  it("numbers and money", () => {
    expect(parseCell(field("NUMBER"), "1,200.5")).toEqual(ok(1200.5));
    expect(parseCell(field("NUMBER", { decimals: 0 }), "3.7")).toEqual(ok(4));
    expect(parseCell(field("CURRENCY"), "$15.005")).toEqual(ok(15.01));
    expect(parseCell(field("NUMBER"), "twelve").ok).toBe(false);
  });

  it("dates, from what people type or paste", () => {
    expect(parseCell(field("DATE"), "2026-10-12")).toEqual(ok("2026-10-12"));
    expect(parseCell(field("DATE"), "10/12/2026")).toEqual(ok("2026-10-12"));
    expect(parseCell(field("DATE"), "2026-02-30").ok).toBe(false);
    expect(parseDateInput("3/4/26")).toBe("2026-03-04");
  });

  it("checkboxes take yes/no words", () => {
    expect(parseCell(field("CHECKBOX"), true)).toEqual(ok(true));
    expect(parseCell(field("CHECKBOX"), "Yes")).toEqual(ok(true));
    expect(parseCell(field("CHECKBOX"), "no")).toEqual(ok(null));
    expect(parseCell(field("CHECKBOX"), false)).toEqual(ok(null));
  });

  it("selects store choice ids, by id or by label", () => {
    const choices = [
      { id: "s", label: "Small", color: "gray" as const },
      { id: "m", label: "Medium", color: "blue" as const },
    ];
    expect(parseCell(field("SELECT", { choices }), "medium")).toEqual(ok("m"));
    expect(parseCell(field("SELECT", { choices }), "s")).toEqual(ok("s"));
    expect(parseCell(field("SELECT", { choices }), "Large").ok).toBe(false);
    expect(parseCell(field("MULTI_SELECT", { choices }), "Medium, small")).toEqual(ok(["s", "m"]));
    expect(parseCell(field("MULTI_SELECT", { choices }), [])).toEqual(ok(null));
  });

  it("members must be in the organization", () => {
    const members = new Set(["u_1"]);
    expect(parseCell(field("MEMBER"), "u_1", members)).toEqual(ok("u_1"));
    expect(parseCell(field("MEMBER"), "u_2", members).ok).toBe(false);
  });

  it("emails, phones and links are normalized", () => {
    expect(parseCell(field("EMAIL"), " Maya@Example.EDU ")).toEqual(ok("maya@example.edu"));
    expect(parseCell(field("EMAIL"), "maya@").ok).toBe(false);
    expect(parseCell(field("PHONE"), "617-555-0101")).toEqual(ok("+16175550101"));
    expect(parseCell(field("URL"), "example.com/club")).toEqual(ok("https://example.com/club"));
    expect(parseCell(field("URL"), "javascript:alert(1)").ok).toBe(false);
  });
});

describe("type changes and display", () => {
  it("keeps what fits the new type and clears the rest", () => {
    expect(convertValue(field("TEXT"), field("NUMBER"), "12")).toBe(12);
    expect(convertValue(field("TEXT"), field("NUMBER"), "Physics")).toBeNull();
    expect(convertValue(field("NUMBER"), field("TEXT"), 12)).toBe("12");
    expect(convertValue(field("TEXT"), field("CHECKBOX"), "yes")).toBe(true);
  });

  const status = [
    { id: "k3j9x0aa1b", label: "Paid", color: "green" as const },
    { id: "p0q8r7s6t5", label: "Unpaid", color: "red" as const },
    { id: "z1y2x3w4v5", label: "12", color: "gray" as const },
  ];
  const people = new Map([
    ["u_maya", "Maya Patel"],
    ["u_jay", "Jay Thompson"],
  ]);

  it("turns choices into their labels, never their ids", () => {
    const select = field("SELECT", { choices: status });
    const multi = field("MULTI_SELECT", { choices: status });
    expect(convertValue(select, field("TEXT"), "k3j9x0aa1b", people)).toBe("Paid");
    expect(convertValue(select, field("LONG_TEXT"), "p0q8r7s6t5", people)).toBe("Unpaid");
    expect(convertValue(multi, field("TEXT"), ["k3j9x0aa1b", "p0q8r7s6t5"], people)).toBe(
      "Paid, Unpaid",
    );
    expect(convertValue(select, field("NUMBER"), "z1y2x3w4v5", people)).toBe(12);
    expect(convertValue(select, field("NUMBER"), "k3j9x0aa1b", people)).toBeNull();
    expect(convertValue(select, field("EMAIL"), "k3j9x0aa1b", people)).toBeNull();
  });

  it("keeps the choice between single and multi-select", () => {
    const select = field("SELECT", { choices: status });
    const multi = field("MULTI_SELECT", { choices: status });
    expect(convertValue(select, multi, "k3j9x0aa1b", people)).toEqual(["k3j9x0aa1b"]);
    expect(convertValue(multi, select, ["p0q8r7s6t5"], people)).toBe("p0q8r7s6t5");
    // Two choices don't fit one: cleared.
    expect(convertValue(multi, select, ["k3j9x0aa1b", "p0q8r7s6t5"], people)).toBeNull();
  });

  it("turns members into their names, never their user ids", () => {
    expect(convertValue(field("MEMBER"), field("TEXT"), "u_maya", people)).toBe("Maya Patel");
    expect(convertValue(field("MEMBER"), field("LONG_TEXT"), "u_jay", people)).toBe("Jay Thompson");
    // Someone who has left the club has no name to keep.
    expect(convertValue(field("MEMBER"), field("TEXT"), "u_gone", people)).toBeNull();
    // A member field only takes people in the club.
    expect(convertValue(field("TEXT"), field("MEMBER"), "u_maya", people)).toBe("u_maya");
    expect(convertValue(field("TEXT"), field("MEMBER"), "u_gone", people)).toBeNull();
  });

  it("makes choices from a column's values: most used first in, long ones left out", () => {
    const values = [
      ...Array.from({ length: 101 }, (_, i) => `Value ${i}`),
      "Value 100",
      "value 100",
      "x".repeat(81),
    ];
    const choices = choicesFromValues(field("TEXT"), "SELECT", values, new Map());
    expect(choices).toHaveLength(100);
    // "Value 100" is used three times (case aside), so it keeps a choice;
    // one of the values used once doesn't, and the 81-character one never does.
    expect(choices.map((c) => c.label)).toContain("Value 100");
    expect(choices.map((c) => c.label)).not.toContain("Value 99");
    expect(choices.some((c) => c.label.length > 80)).toBe(false);
    expect(new Set(choices.map((c) => c.id)).size).toBe(100);
  });

  it("makes choices from what other types show", () => {
    const labels = (from: Parameters<typeof choicesFromValues>[0], values: unknown[]) =>
      choicesFromValues(from, "MULTI_SELECT", values, people).map((c) => c.label);
    expect(labels(field("MEMBER"), ["u_maya", "u_jay", "u_maya"])).toEqual([
      "Maya Patel",
      "Jay Thompson",
    ]);
    expect(labels(field("CHECKBOX"), [true, true])).toEqual(["Yes"]);
    expect(labels(field("CURRENCY"), [15.5])).toEqual(["$15.50"]);
    expect(labels(field("TEXT"), ["Red; Blue", "blue,Green"])).toEqual(["Red", "Blue", "Green"]);
  });

  it("fingerprints a choice list, so a save from a stale copy can be refused", () => {
    const v = choicesVersion(status);
    expect(choicesVersion(status.map((c) => ({ ...c })))).toBe(v);
    expect(choicesVersion(status.slice(0, 2))).not.toBe(v);
    expect(choicesVersion([{ ...status[0]!, label: "Paid in full" }, ...status.slice(1)])).not.toBe(
      v,
    );
    expect(choicesVersion([{ ...status[0]!, color: "blue" }, ...status.slice(1)])).not.toBe(v);
    expect(choicesVersion(undefined)).toBe(choicesVersion([]));
  });

  it("shows values as plain text for search and CSV", () => {
    const choices = [{ id: "m", label: "Medium", color: "blue" as const }];
    expect(displayText(field("SELECT", { choices }), "m", new Map())).toBe("Medium");
    expect(displayText(field("CURRENCY"), 15.5, new Map())).toBe("$15.50");
    expect(displayText(field("MEMBER"), "u_1", new Map([["u_1", "Maya Patel"]]))).toBe(
      "Maya Patel",
    );
    expect(displayText(field("CHECKBOX"), true, new Map())).toBe("Yes");
  });
});

describe("guessing a spreadsheet column's type", () => {
  it("picks the most specific type every value fits", () => {
    expect(inferFieldType(["yes", "no", "Yes"])).toBe("CHECKBOX");
    expect(inferFieldType(["$15.00", "$2.50"])).toBe("CURRENCY");
    expect(inferFieldType(["1", "2.5", "-3"])).toBe("NUMBER");
    expect(inferFieldType(["02134", "02139"])).not.toBe("NUMBER");
    expect(inferFieldType(["a@x.edu", "b@y.edu"])).toBe("EMAIL");
    expect(inferFieldType(["2026-10-12", "10/13/2026"])).toBe("DATE");
    expect(inferFieldType(["M", "L", "S", "M", "M", "L"])).toBe("SELECT");
    expect(inferFieldType(["Maya", "Jay", "Alex", "Priya"])).toBe("TEXT");
    expect(inferFieldType(["", " "])).toBe("TEXT");
  });

  it("keeps phone numbers and ids out of numbers", () => {
    // Written like phone numbers.
    expect(inferFieldType(["617 555 0101", "617 555 0102"])).toBe("PHONE");
    expect(inferFieldType(["+16175550101", "+447700900123"])).toBe("PHONE");
    expect(inferFieldType(["(617) 555-0101", "617.555.0102"])).toBe("PHONE");
    // Bare digits under a phone heading.
    expect(inferFieldType(["5551234567", "5559876543"], "Phone")).toBe("PHONE");
    expect(inferFieldType(["5551234567"], "Mobile number")).toBe("PHONE");
    // Ids: leading zeros, the same length every time, or an id heading.
    expect(inferFieldType(["001234567", "002345678"])).toBe("TEXT");
    expect(inferFieldType(["123456789", "234567890", "345678901"])).toBe("TEXT");
    expect(inferFieldType(["12", "345"], "Student ID")).toBe("TEXT");
    expect(inferFieldType(["4410", "4411"], "Order #")).toBe("TEXT");
    // Still numbers: counts, amounts, decimals, different lengths.
    expect(inferFieldType(["2", "14", "3"], "Number of guests")).toBe("NUMBER");
    expect(inferFieldType(["1234.5678", "99.5"])).toBe("NUMBER");
    expect(inferFieldType(["1500000", "250000"])).toBe("NUMBER");
    expect(inferFieldType(["1234567"])).toBe("NUMBER");
    // Dates stay dates.
    expect(inferFieldType(["2026-10-12", "2026-10-13"])).toBe("DATE");
  });

  it("keeps an imported number's decimals (up to 4)", () => {
    expect(parseCell(field("NUMBER"), "3.14159")).toEqual(ok(3.1416));
    expect(parseCell(field("NUMBER"), "0.125")).toEqual(ok(0.125));
  });
});

describe("templates", () => {
  it("each starts with a field that can name rows, and has unique field names", () => {
    for (const t of DATABASE_TEMPLATES) {
      expect(["TEXT", "NUMBER", "EMAIL", "PHONE", "URL"]).toContain(t.fields[0]!.type);
      const names = t.fields.map((f) => f.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
