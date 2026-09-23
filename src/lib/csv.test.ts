import { describe, expect, it } from "vitest";

import { csvCell, csvContentDisposition, csvRow, toCsv } from "./csv";

describe("csvCell formula guard", () => {
  it.each(["=SUM(A1:A2)", "+1+1", "-2+cmd|' /C calc'!A0", "@SUM(1)", "\tx", "\rx"])(
    "neutralizes %j",
    (value) => {
      const cell = csvCell(value);
      expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("leaves plain numbers and ordinary text alone", () => {
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("12")).toBe("12");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell("Pizza for meeting")).toBe("Pizza for meeting");
  });

  it("quotes commas, quotes, CR and LF", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });

  it("formats other values", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF rows, with an optional BOM", () => {
    expect(toCsv([["a", 1]], { header: ["Name", "N"] })).toBe("Name,N\r\na,1\r\n");
    expect(toCsv([], { header: ["x"], bom: true })).toBe("﻿x\r\n");
    expect(csvRow(["=x", "y"])).toBe("'=x,y");
  });

  it("builds a safe Content-Disposition", () => {
    expect(csvContentDisposition("transactions.csv")).toBe(
      `attachment; filename="transactions.csv"; filename*=UTF-8''transactions.csv`,
    );
    expect(csvContentDisposition('a"b\r\n.csv')).not.toMatch(/["\r\n]b/);
  });
});
