import { describe, expect, it } from "vitest";

import type { FieldDef } from "@/lib/databases/fields";

import { customSortValue, orderByCustom } from "./crm";

/** The CRM's custom columns sort in Databases (docs/features/crm.md, "Integration as built"). */

const field = (type: FieldDef["type"], options: FieldDef["options"] = {}): FieldDef => ({
  id: "f1",
  name: "Field",
  type,
  options,
  isPrimary: false,
});

const rows = (values: unknown[]) => values.map((v, i) => ({ id: `r${i}`, custom: v === undefined ? {} : { f1: v } }));

describe("sorting by a custom CRM column", () => {
  it("orders numbers as numbers, with empty ones last either way", () => {
    const f = field("NUMBER");
    const r = rows([10, 2, undefined, 33]);
    expect(orderByCustom(r, f, "asc")).toEqual(["r1", "r0", "r3", "r2"]);
    expect(orderByCustom(r, f, "desc")).toEqual(["r3", "r0", "r1", "r2"]);
  });

  it("orders choices in the order they're listed, not by their names", () => {
    const f = field("SELECT", { choices: [{ id: "c_hot", label: "Hot", color: "red" }, { id: "c_warm", label: "Warm", color: "orange" }, { id: "c_cold", label: "Cold", color: "blue" }] });
    expect(orderByCustom(rows(["c_cold", "c_hot", "c_warm"]), f, "asc")).toEqual(["r1", "r2", "r0"]);
    expect(customSortValue(f, "gone")).toBeNull();
  });

  it("orders dates, text without case, and checkboxes", () => {
    expect(orderByCustom(rows(["2026-03-01", "2025-12-31"]), field("DATE"), "asc")).toEqual(["r1", "r0"]);
    expect(orderByCustom(rows(["banana", "Apple", "cherry"]), field("TEXT"), "asc")).toEqual(["r1", "r0", "r2"]);
    expect(orderByCustom(rows([false, true]), field("CHECKBOX"), "desc")).toEqual(["r1", "r0"]);
  });
});
