import { describe, expect, it } from "vitest";

import { TransactionKind } from "@/generated/prisma/enums";

import {
  applyBudgetMapping,
  applyMapping,
  guessMapping,
  inferKind,
  isImportable,
  labelKey,
  rowProblems,
  setColumnRole,
} from "./mapping";

const today = "2026-10-01";
const sheet = (rows: string[][]) => ({ rows, rowNumbers: rows.map((_, i) => i + 1) });

describe("guessMapping", () => {
  it("reads a bank export: signed amounts, a balance column left alone, Description over Details", () => {
    const s = sheet([
      ["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"],
      ["DEBIT", "09/05/2025", "DOMINOS 4432", "-84.50", "DEBIT_CARD", "1215.50", ""],
      ["CREDIT", "09/08/2025", "ZELLE FROM ALEX GREEN", "240.00", "QUICKPAY_CREDIT", "1455.50", ""],
    ]);
    const m = guessMapping(s, today);
    expect(m.kind).toBe("transactions");
    expect(m.headerRow).toBe(0);
    expect(m.roles).toEqual(["ignore", "date", "description", "amount", "type", "ignore", "ignore"]);
    expect(m.amountSign).toBe("negative-out");

    const rows = applyMapping(s, m, { today });
    expect(rows.map((r) => [r.date, r.amountCents, r.direction, r.kind])).toEqual([
      ["2025-09-05", 8450, "OUT", TransactionKind.EXPENSE],
      ["2025-09-08", 24000, "IN", TransactionKind.OTHER_INCOME],
    ]);
    expect(rows[0].source).toBe("Row 2");
  });

  it("reads a Venmo statement: title rows above the header, signed amounts, the note as the description", () => {
    const s = sheet([
      ["Account Statement - (@cbc-neu)"],
      ["Account Activity"],
      ["", "ID", "Datetime", "Type", "Status", "Note", "From", "To", "Amount (total)", "Amount (fee)", "Funding Source", "Beginning Balance", "Ending Balance"],
      ["", "4058", "2025-09-05T14:33:00", "Payment", "Complete", "pizza 🍕", "CBC", "Dominos", "- $84.50", "", "Venmo balance", "", ""],
      ["", "4059", "2025-09-06T10:00:00", "Payment", "Complete", "dues", "Riley Chen", "CBC", "+ $20.00", "", "", "", ""],
    ]);
    const m = guessMapping(s, today);
    expect(m.headerRow).toBe(2);
    expect(m.roles[2]).toBe("date");
    expect(m.roles[5]).toBe("description");
    expect(m.roles[6]).toBe("counterparty");
    expect(m.roles[8]).toBe("amount");
    expect(m.roles[10]).toBe("paymentMethod");
    expect(m.amountSign).toBe("negative-out");
    const rows = applyMapping(s, m, { today });
    expect(rows.map((r) => [r.description, r.amountCents, r.direction, r.counterparty])).toEqual([
      ["pizza 🍕", 8450, "OUT", "CBC"],
      ["dues", 2000, "IN", "Riley Chen"],
    ]);
  });

  it("reads a hand-made expense list as money out, and keeps the sheet's categories", () => {
    const s = sheet([
      ["Date", "Item", "Category", "Cost", "Paid by"],
      ["9/5", "Pizza for kickoff", "Food", "$84.50", "Riley"],
      ["9/12", "Posters", "Marketing", "35.2", "Alex"],
      ["", "TOTAL", "", "119.70", ""],
    ]);
    const m = guessMapping(s, today);
    expect(m.roles).toEqual(["date", "description", "category", "amount", "counterparty"]);
    expect(m.amountSign).toBe("all-out");
    const rows = applyMapping(s, m, { today });
    expect(rows[0]).toMatchObject({ date: "2026-09-05", amountCents: 8450, direction: "OUT", category: "Food", include: true });
    expect(rows[1]).toMatchObject({ date: "2026-09-12", amountCents: 3520, category: "Marketing" });
    expect(rows[2]).toMatchObject({ include: false, summaryLine: true });
    expect(rowProblems(rows[2])).toEqual(["No date", "Looks like a total or balance line"]);
  });

  it("reads separate money in and money out columns", () => {
    const s = sheet([
      ["Date", "Memo", "Withdrawals", "Deposits"],
      ["2025-09-05", "Pizza", "84.50", ""],
      ["2025-09-08", "Dues", "", "240.00"],
    ]);
    const m = guessMapping(s, today);
    expect(m.roles).toEqual(["date", "description", "moneyOut", "moneyIn"]);
    const rows = applyMapping(s, m, { today });
    expect(rows.map((r) => [r.direction, r.amountCents])).toEqual([
      ["OUT", 8450],
      ["IN", 24000],
    ]);
  });

  it("uses a type column when the amounts carry no sign", () => {
    const s = sheet([
      ["Date", "Description", "Type", "Amount"],
      ["2025-09-05", "Pizza", "Expense", "84.50"],
      ["2025-09-08", "Dues", "Income", "240.00"],
    ]);
    const m = guessMapping(s, today);
    expect(m.amountSign).toBe("by-type");
    expect(m.typeIn).toEqual(["income"]);
    expect(m.typeOut).toEqual(["expense"]);
    const rows = applyMapping(s, m, { today });
    expect(rows.map((r) => r.direction)).toEqual(["OUT", "IN"]);
  });

  it("reads an income list as money in from its header", () => {
    const m = guessMapping(sheet([["Date", "Name", "Dues paid"], ["9/5/2026", "Riley", "20"]]), today);
    expect(m.amountSign).toBe("all-in");
    expect(m.roles).toEqual(["date", "counterparty", "amount"]);
  });

  it("recognizes a budget sheet", () => {
    const s = sheet([
      ["Category", "Budget", "Spent", "Remaining"],
      ["Food", "$1,200", "300", "900"],
      ["Travel", "800", "0", "800"],
      ["Total", "2000", "300", "1700"],
    ]);
    const m = guessMapping(s, today);
    expect(m.kind).toBe("budget");
    expect(applyBudgetMapping(s, m).map((l) => [l.name, l.allocatedCents])).toEqual([
      ["Food", 120000],
      ["Travel", 80000],
    ]);
  });

  it("finds the columns of a sheet with no header from its values", () => {
    const s = sheet([
      ["9/5/2025", "Pizza for the kickoff", "84.50"],
      ["9/12/2025", "Poster printing", "35.20"],
    ]);
    const m = guessMapping(s, today);
    expect(m.headerRow).toBe(-1);
    expect(m.roles).toEqual(["date", "description", "amount"]);
    expect(applyMapping(s, m, { today })).toHaveLength(2);
  });
});

describe("editing a mapping", () => {
  it("moves a unique role instead of duplicating it", () => {
    const m = guessMapping(sheet([["Date", "Item", "Cost"], ["9/5/2026", "x", "1"]]), today);
    const moved = setColumnRole(m, 1, "amount");
    expect(moved.roles).toEqual(["date", "amount", "ignore"]);
    expect(setColumnRole(moved, 2, "notes").roles).toEqual(["date", "amount", "notes"]);
  });
});

describe("AI labels and kinds", () => {
  it("files rows under the category the model gave their values, and takes its kind when it fits", () => {
    const s = sheet([
      ["Date", "Description", "Amount"],
      ["2025-09-05", "Dominos", "-84.50"],
      ["2025-09-06", "Acme Corp", "500"],
    ]);
    const m = guessMapping(s, today);
    const labels = new Map([
      [labelKey(1, "Dominos"), { category: "Food", kind: null }],
      [labelKey(1, "acme corp "), { category: "Sponsorships", kind: TransactionKind.SPONSORSHIP }],
    ]);
    const rows = applyMapping(s, m, { today, labels });
    expect(rows.map((r) => [r.category, r.kind])).toEqual([
      ["Food", TransactionKind.EXPENSE],
      ["Sponsorships", TransactionKind.SPONSORSHIP],
    ]);
  });

  it("infers kinds from the words, and never an income kind for money out", () => {
    expect(inferKind("IN", "Spring sponsorship from Acme")).toBe(TransactionKind.SPONSORSHIP);
    expect(inferKind("IN", "SGA allocation")).toBe(TransactionKind.ALLOCATION);
    expect(inferKind("IN", "Starting balance")).toBe(TransactionKind.ADJUSTMENT);
    expect(inferKind("IN", "Dues")).toBe(TransactionKind.OTHER_INCOME);
    expect(inferKind("OUT", "Sponsor dinner")).toBe(TransactionKind.EXPENSE);
    expect(inferKind("OUT", "x", TransactionKind.SPONSORSHIP)).toBe(TransactionKind.EXPENSE);
  });

  it("only counts complete rows as importable", () => {
    const base = {
      key: "r1",
      source: "Row 1",
      description: "x",
      kind: TransactionKind.EXPENSE,
      category: null,
      counterparty: null,
      paymentMethod: null,
      include: true,
    };
    expect(isImportable({ ...base, date: "2025-09-05", amountCents: 100, direction: "OUT" })).toBe(true);
    expect(isImportable({ ...base, date: null, amountCents: 100, direction: "OUT" })).toBe(false);
    expect(isImportable({ ...base, date: "2025-09-05", amountCents: 100, direction: null })).toBe(false);
  });
});
