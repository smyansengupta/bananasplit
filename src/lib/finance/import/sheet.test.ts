import { describe, expect, it } from "vitest";

import { decodeText, detectDelimiter, isDocumentFile, parseDelimited, readPastedTable, readTableFile, SpreadsheetError } from "./sheet";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("delimited text", () => {
  it("detects commas, tabs and semicolons", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2,5;3")).toBe(";");
    expect(detectDelimiter('"x, y",b\n"1, 2",3')).toBe(",");
  });

  it("parses quotes, doubled quotes, CRLF, a BOM, and keeps line numbers", () => {
    const sheet = parseDelimited('﻿Date,Item,Amount\r\n9/5,"Pizza, large",12\r\n\r\n9/6,"Say ""hi""\nagain",3\n');
    expect(sheet.rows).toEqual([
      ["Date", "Item", "Amount"],
      ["9/5", "Pizza, large", "12"],
      ["9/6", 'Say "hi"\nagain', "3"],
    ]);
    expect(sheet.rowNumbers).toEqual([1, 2, 4]);
  });

  it("strips the formula guard and trailing empty cells", () => {
    expect(parseDelimited("'=SUM(A1),x,,\n").rows).toEqual([["=SUM(A1)", "x"]]);
  });

  it("reads rows pasted from a spreadsheet as tab-separated", () => {
    expect(readPastedTable("Date\tItem\tAmount\n9/5\tPizza\t12").rows[1]).toEqual(["9/5", "Pizza", "12"]);
  });
});

describe("files", () => {
  it("reads a CSV under its file name", () => {
    const [sheet] = readTableFile("ledger-2025.csv", bytes("Date,Amount\n9/5,12"));
    expect(sheet.name).toBe("ledger-2025");
    expect(sheet.rows).toHaveLength(2);
  });

  it("explains the formats it can't read", () => {
    expect(() => readTableFile("old.xls", bytes("ÐÏ\u0011"))).toThrow(SpreadsheetError);
    expect(() => readTableFile("budget.numbers", bytes("x"))).toThrow(/xlsx or CSV/);
    expect(() => readTableFile("empty.csv", bytes("\n\n"))).toThrow(/no rows/);
    expect(() => readTableFile("blob.csv", new Uint8Array([1, 0, 2, 0]))).toThrow(SpreadsheetError);
  });

  it("falls back to Windows-1252 for CSVs Excel saved that way", () => {
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
    expect(decodeText(bytes("Café"))).toBe("Café");
  });

  it("knows which files go to the AI reader", () => {
    expect(isDocumentFile("statement.PDF")).toBe(true);
    expect(isDocumentFile("receipt.jpeg")).toBe(true);
    expect(isDocumentFile("ledger.csv")).toBe(false);
  });
});
