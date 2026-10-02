import { TransactionKind } from "@/generated/prisma/enums";

import type { SheetData } from "./xlsx";
import {
  guessDateOrder,
  looksLikeAmounts,
  looksLikeDates,
  MAX_IMPORT_CENTS,
  parseAmount,
  parseDate,
  type DateOrder,
} from "./values";

/**
 * Which column is which, in a spreadsheet nobody designed for us. A guess
 * comes from the header words and the values (no AI needed for a tidy
 * ledger or a bank export); the AI reader (src/server/ai/finance-import.ts)
 * can replace it; the treasurer can change any column by hand. Applying a
 * mapping turns every row into a proposed transaction (or budget line) with
 * the problems a person should look at. Pure and client-safe: it runs in
 * the browser on the whole file, and the server validates what's imported.
 */

export const COLUMN_ROLES = [
  "date",
  "description",
  "amount",
  "moneyIn",
  "moneyOut",
  "type",
  "category",
  "counterparty",
  "paymentMethod",
  "notes",
  "allocated",
  "ignore",
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABEL: Record<ColumnRole, string> = {
  date: "Date",
  description: "Description",
  amount: "Amount",
  moneyIn: "Money in",
  moneyOut: "Money out",
  type: "In or out (type)",
  category: "Category",
  counterparty: "Paid to / from",
  paymentMethod: "Payment method",
  notes: "Notes",
  allocated: "Budgeted amount",
  ignore: "Don't import",
};

/** How one amount column says which way the money went. */
export const AMOUNT_SIGNS = ["negative-out", "positive-out", "all-out", "all-in", "by-type"] as const;
export type AmountSign = (typeof AMOUNT_SIGNS)[number];

export const AMOUNT_SIGN_LABEL: Record<AmountSign, string> = {
  "negative-out": "Negative amounts are money out",
  "positive-out": "Positive amounts are money out",
  "all-out": "Every row is money out",
  "all-in": "Every row is money in",
  "by-type": "The type column says in or out",
};

export type SheetKind = "transactions" | "budget";

export interface SheetMapping {
  /** A ledger of money in and out, or a budget (category and amount per line). */
  kind: SheetKind;
  /** Index (into the sheet's rows) of the header row; -1 when it has none. */
  headerRow: number;
  /** One role per column; "ignore" for the rest. */
  roles: ColumnRole[];
  amountSign: AmountSign;
  /** Type-column values (lowercase) that mean money in, and money out. */
  typeIn: string[];
  typeOut: string[];
  dateOrder: DateOrder;
}

/** What the AI reader says about one value: the category it belongs in and its kind. */
export interface ValueLabel {
  category: string | null;
  kind: TransactionKind | null;
}

export type Direction = "IN" | "OUT";

export interface ImportRow {
  /** Stable React key. */
  key: string;
  /** Where it came from, for people: "Row 12". */
  source: string;
  date: string | null;
  description: string;
  amountCents: number | null;
  direction: Direction | null;
  kind: TransactionKind;
  category: string | null;
  counterparty: string | null;
  paymentMethod: string | null;
  include: boolean;
  /** Set when the row reads as a total or balance line rather than a transaction. */
  summaryLine?: boolean;
}

export interface BudgetLine {
  key: string;
  source: string;
  name: string;
  allocatedCents: number | null;
  include: boolean;
}

export const MAX_DESCRIPTION = 500;
export const MAX_CATEGORY_NAME = 60;
const SHORT_TEXT = 200;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$#]+/g, " ")
    .trim();

/** Header words, most specific first. "Balance" is recognized so it's never read as an amount. */
const HEADER_RULES: readonly [ColumnRole, RegExp][] = [
  ["ignore", /^(id|transaction id|txn id|ref|reference|ref no|no|#|number|check|check no|check number|balance|running balance|ending balance|available balance|status|receipt|receipts link|link|url|email|phone|year|month)$/],
  ["date", /\bdate\b|^(day|when|posted|datetime|date time|timestamp|time stamp|paid on|purchased on)$/],
  ["moneyIn", /^(credit|credits|credit amount|deposit|deposits|money in|income|incoming|received|amount received|inflow|in|paid in|revenue|cash in)$/],
  ["moneyOut", /^(debit|debits|debit amount|withdrawal|withdrawals|money out|expense|expenses|spent|amount spent|outflow|out|paid out|payment|payments|charge|charges|cash out|outgoing)$/],
  ["allocated", /^(budget|budgeted|budget amount|allocated|allocation|allocated amount|planned|plan|projected|requested|approved budget)$/],
  ["amount", /\bamount\b|^(total|cost|costs|price|value|sum|net|usd|dollars|\$)$/],
  ["type", /^(type|transaction type|kind|in out|in or out|direction|debit credit|dr cr|income expense|income or expense|flow)$/],
  ["category", /^(category|categories|budget line|line item|account|class|tag|bucket|group|committee|fund|budget category|expense category|expense type)$/],
  ["counterparty", /^(payee|vendor|merchant|from|to|paid to|paid by|store|company|sponsor|who|person|name|recipient|payer|purchaser|purchased by|submitted by|member|bought by)$/],
  ["paymentMethod", /^(method|payment method|paid with|paid via|via|card|payment type|account used|funding source|source)$/],
  ["description", /^(description|desc|item|items|memo|details|detail|purpose|what|what for|for|transaction|particulars|narrative|note|reason|event|expense name|purchase|title)$/],
  ["notes", /^(notes|comments|comment|remarks)$/],
];

/**
 * Headers that name a role outright. When two columns could hold the same
 * role (a bank's "Details" and "Description"), the outright one wins.
 */
const PRIMARY: Partial<Record<ColumnRole, RegExp>> = {
  date: /^(date|transaction date|posting date|posted date|trans date)$/,
  description: /^(description|item|memo)$/,
  amount: /^(amount|amount total|total amount|transaction amount)$/,
  category: /^category$/,
  counterparty: /^(payee|vendor|merchant)$/,
};

export function headerRole(header: string): ColumnRole | null {
  const h = norm(header);
  if (!h) return null;
  for (const [role, re] of HEADER_RULES) if (re.test(h)) return role;
  return null;
}

function headerStrength(header: string, role: ColumnRole): number {
  return PRIMARY[role]?.test(norm(header)) ? 2 : 1;
}

/** Roles a column can hold only once (two "notes" or "ignore" columns are fine). */
const UNIQUE: ReadonlySet<ColumnRole> = new Set(COLUMN_ROLES.filter((r) => r !== "ignore" && r !== "notes"));

const IN_WORDS = new Set([
  "credit", "cr", "deposit", "income", "in", "received", "revenue", "refund", "money in", "inflow", "incoming",
  "dues", "donation", "sponsorship", "payment received", "transfer in",
]);
const OUT_WORDS = new Set([
  "debit", "dr", "withdrawal", "expense", "out", "purchase", "charge", "spent", "money out", "outflow", "outgoing",
  "fee", "reimbursement", "transfer out", "bill", "cost",
]);

function columnValues(rows: readonly string[][], col: number, from: number, limit = 400): string[] {
  const out: string[] = [];
  for (let r = from; r < rows.length && out.length < limit; r++) out.push(rows[r][col] ?? "");
  return out;
}

function widthOf(rows: readonly string[][]): number {
  return rows.reduce((w, r) => Math.max(w, r.length), 0);
}

/** The row that reads most like a header within the first 15, or -1. */
export function findHeaderRow(rows: readonly string[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const cells = rows[r].filter((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells.filter((c) => parseAmount(c)).length > cells.length / 2) continue;
    const score = cells.filter((c) => headerRole(c)).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The best guess at a mapping: header words first, then the values (a
 * column of dates, a column of amounts, the longest text). Money columns
 * decide the sign rule: signed amounts are read as a bank does (negative is
 * money out); all-positive amounts are an expense list unless the header
 * says income, or a type column says which way each went.
 */
export function guessMapping(sheet: Pick<SheetData, "rows">, today: string): SheetMapping {
  const rows = sheet.rows;
  const headerRow = findHeaderRow(rows);
  const width = widthOf(rows);
  const roles: ColumnRole[] = Array.from({ length: width }, () => "ignore");
  const taken = new Set<ColumnRole>();
  const assign = (col: number, role: ColumnRole) => {
    if (UNIQUE.has(role) && taken.has(role)) return false;
    roles[col] = role;
    taken.add(role);
    return true;
  };

  if (headerRow >= 0) {
    rows[headerRow]
      .flatMap((h, col) => {
        const role = headerRole(h);
        return role ? [{ col, role, strength: headerStrength(h, role) }] : [];
      })
      .sort((a, b) => b.strength - a.strength || a.col - b.col)
      .forEach(({ col, role }) => assign(col, role));
  }
  const from = headerRow + 1;
  const values = (col: number) => columnValues(rows, col, from);
  const free = (col: number) => roles[col] === "ignore" && !(headerRow >= 0 && headerRole(rows[headerRow][col] ?? "") === "ignore");

  if (!taken.has("date")) {
    for (let c = 0; c < width; c++) if (free(c) && looksLikeDates(values(c), today) && assign(c, "date")) break;
  }
  const hasMoney = ["amount", "moneyIn", "moneyOut", "allocated"].some((r) => taken.has(r as ColumnRole));
  if (!hasMoney) {
    for (let c = 0; c < width; c++) if (free(c) && looksLikeAmounts(values(c)) && assign(c, "amount")) break;
  }
  if (!taken.has("description")) {
    let best = -1;
    let bestLength = 0;
    for (let c = 0; c < width; c++) {
      if (!free(c)) continue;
      const vals = values(c).filter((v) => v.trim());
      if (vals.length === 0 || looksLikeAmounts(vals) || looksLikeDates(vals, today)) continue;
      const avg = vals.reduce((s, v) => s + v.length, 0) / vals.length;
      if (avg > bestLength) {
        best = c;
        bestLength = avg;
      }
    }
    if (best >= 0) assign(best, "description");
  }

  const kind: SheetKind = taken.has("allocated") && !taken.has("date") ? "budget" : "transactions";
  if (kind === "budget" && !taken.has("category") && roles.includes("description")) {
    roles[roles.indexOf("description")] = "category";
  }

  const dateCol = roles.indexOf("date");
  const dateOrder = dateCol >= 0 ? guessDateOrder(values(dateCol)) : "MDY";
  const { amountSign, typeIn, typeOut } = guessSign(rows, roles, headerRow);
  return { kind, headerRow, roles, amountSign, typeIn, typeOut, dateOrder };
}

function guessSign(
  rows: readonly string[][],
  roles: readonly ColumnRole[],
  headerRow: number,
): Pick<SheetMapping, "amountSign" | "typeIn" | "typeOut"> {
  const amountCol = roles.indexOf("amount");
  const typeCol = roles.indexOf("type");
  const typeValues = typeCol >= 0 ? [...new Set(columnValues(rows, typeCol, headerRow + 1).map(norm).filter(Boolean))] : [];
  const typeIn = typeValues.filter((v) => IN_WORDS.has(v));
  const typeOut = typeValues.filter((v) => OUT_WORDS.has(v));
  if (amountCol < 0) return { amountSign: "all-out", typeIn, typeOut };
  const amounts = columnValues(rows, amountCol, headerRow + 1).map(parseAmount).filter((a) => a !== null);
  const negatives = amounts.filter((a) => a.negative).length;
  if (negatives > 0 && negatives < amounts.length) return { amountSign: "negative-out", typeIn, typeOut };
  if (typeCol >= 0 && typeIn.length + typeOut.length > 0) return { amountSign: "by-type", typeIn, typeOut };
  const header = headerRow >= 0 ? norm(rows[headerRow][amountCol] ?? "") : "";
  if (/income|deposit|received|revenue|dues|donation|credit/.test(header)) return { amountSign: "all-in", typeIn, typeOut };
  return { amountSign: "all-out", typeIn, typeOut };
}

/** Puts `role` on `col`, clearing it from any other column that held it. */
export function setColumnRole(mapping: SheetMapping, col: number, role: ColumnRole): SheetMapping {
  const roles = mapping.roles.map((r, i) => (i === col ? role : UNIQUE.has(role) && r === role ? "ignore" : r));
  while (roles.length <= col) roles.push("ignore");
  roles[col] = role;
  return { ...mapping, roles };
}

/** The key a ValueLabel is stored under: the column and the value, normalised and clipped as the AI saw it. */
export function labelKey(col: number, value: string): string {
  return `${col}␟${value.trim().slice(0, 80).trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** Whether a kind can go the given way (EXPENSE is out; SPONSORSHIP and OTHER_INCOME are in). */
export function kindFits(kind: TransactionKind, direction: Direction): boolean {
  if (kind === TransactionKind.EXPENSE) return direction === "OUT";
  if (kind === TransactionKind.SPONSORSHIP || kind === TransactionKind.OTHER_INCOME) return direction === "IN";
  return true;
}

const BALANCE_WORDS = /starting balance|opening balance|beginning balance|carry ?over|roll ?over|balance (forward|brought forward)/i;

/** The kind a row most likely is, from its direction and words, unless a fitting hint says otherwise. */
export function inferKind(direction: Direction | null, text: string, hint?: TransactionKind | null): TransactionKind {
  if (hint && direction && kindFits(hint, direction)) return hint;
  if (direction !== "IN") return TransactionKind.EXPENSE;
  if (/sponsor/i.test(text)) return TransactionKind.SPONSORSHIP;
  if (/allocat|\bsga\b|student government|student activit|funding award/i.test(text)) return TransactionKind.ALLOCATION;
  if (BALANCE_WORDS.test(text)) return TransactionKind.ADJUSTMENT;
  return TransactionKind.OTHER_INCOME;
}

const SUMMARY_LINE = /^(sub ?)?totals?\b|^grand total|^(opening|beginning|starting|ending|closing) balance|^balance\b|^carry ?over|^net\b/i;

export interface ApplyOptions {
  /** The club's local date (YYYY-MM-DD), for dates without a year. */
  today: string;
  labels?: ReadonlyMap<string, ValueLabel>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Every data row under the header as a proposed transaction. */
export function applyMapping(sheet: Pick<SheetData, "rows" | "rowNumbers">, mapping: SheetMapping, opts: ApplyOptions): ImportRow[] {
  const col = (role: ColumnRole) => mapping.roles.indexOf(role);
  const [dateCol, descCol, amountCol, inCol, outCol, typeCol, catCol, partyCol, methodCol] = (
    ["date", "description", "amount", "moneyIn", "moneyOut", "type", "category", "counterparty", "paymentMethod"] as const
  ).map(col);
  const noteCols = mapping.roles.flatMap((r, i) => (r === "notes" ? [i] : []));
  const start = mapping.headerRow + 1;
  const dataRows = sheet.rows.slice(start);
  const serials =
    dateCol >= 0 && dataRows.some((r) => r[dateCol]?.trim()) &&
    dataRows.every((r) => !r[dateCol]?.trim() || /^\d{5}(?:\.\d+)?$/.test(r[dateCol].trim()));
  const typeIn = new Set(mapping.typeIn.map(norm));
  const typeOut = new Set(mapping.typeOut.map(norm));
  const cell = (cells: string[], c: number) => (c >= 0 ? (cells[c] ?? "").trim() : "");
  const label = (c: number, value: string) => (c >= 0 && value ? opts.labels?.get(labelKey(c, value)) : undefined);

  return dataRows.map((cells, i) => {
    const rowNumber = sheet.rowNumbers[start + i] ?? start + i + 1;
    const date = dateCol >= 0 ? parseDate(cell(cells, dateCol), { order: mapping.dateOrder, today: opts.today, serials }) : null;

    let amountCents: number | null = null;
    let direction: Direction | null = null;
    if (inCol >= 0 || outCol >= 0) {
      const inAmount = inCol >= 0 ? parseAmount(cell(cells, inCol)) : null;
      const outAmount = outCol >= 0 ? parseAmount(cell(cells, outCol)) : null;
      const net = (inAmount?.cents ?? 0) - (outAmount?.cents ?? 0);
      if (net !== 0) {
        amountCents = Math.abs(net);
        direction = net > 0 ? "IN" : "OUT";
      } else if (amountCol >= 0) {
        // Some exports put both in one column and only the odd row elsewhere.
        const a = parseAmount(cell(cells, amountCol));
        if (a && a.cents > 0) {
          amountCents = a.cents;
          direction = a.negative ? "OUT" : "IN";
        }
      }
    } else if (amountCol >= 0) {
      const a = parseAmount(cell(cells, amountCol));
      if (a && a.cents > 0) {
        amountCents = a.cents;
        const type = norm(cell(cells, typeCol));
        switch (mapping.amountSign) {
          case "negative-out":
            direction = a.negative ? "OUT" : "IN";
            break;
          case "positive-out":
            direction = a.negative ? "IN" : "OUT";
            break;
          case "all-out":
            direction = "OUT";
            break;
          case "all-in":
            direction = "IN";
            break;
          case "by-type":
            direction = typeIn.has(type) ? "IN" : typeOut.has(type) ? "OUT" : a.negative ? "OUT" : null;
            break;
        }
      }
    }
    if (amountCents !== null && amountCents > MAX_IMPORT_CENTS) amountCents = null;

    const categoryText = cell(cells, catCol);
    const descText = cell(cells, descCol);
    const party = cell(cells, partyCol);
    const typeText = cell(cells, typeCol);
    const hint = label(catCol, categoryText) ?? label(descCol, descText) ?? label(partyCol, party);
    const category = hint?.category?.trim() || categoryText || null;
    const notes = noteCols.map((c) => cell(cells, c)).filter(Boolean).join("; ");
    const base = descText || party || categoryText || "Imported transaction";
    const description = clip(notes && notes !== base ? `${base} (${notes})` : base, MAX_DESCRIPTION);
    const text = [descText, categoryText, party, typeText].join(" ");
    const summaryLine = SUMMARY_LINE.test(descText || cells.find((c) => c.trim()) || "");

    return {
      key: `r${start + i}`,
      source: `Row ${rowNumber}`,
      date,
      description,
      amountCents,
      direction,
      kind: inferKind(direction, text, hint?.kind),
      category: category ? clip(category, MAX_CATEGORY_NAME) : null,
      counterparty: party ? clip(party, SHORT_TEXT) : null,
      paymentMethod: cell(cells, methodCol) ? clip(cell(cells, methodCol), 100) : null,
      include: Boolean(date && amountCents && direction) && !summaryLine,
      ...(summaryLine ? { summaryLine } : {}),
    };
  });
}

/** What's wrong with a row, for people. Empty when it can be imported. */
export function rowProblems(row: Pick<ImportRow, "date" | "amountCents" | "direction" | "summaryLine">): string[] {
  const problems: string[] = [];
  if (!row.date) problems.push("No date");
  if (!row.amountCents) problems.push("No amount");
  else if (!row.direction) problems.push("In or out?");
  if (row.summaryLine) problems.push("Looks like a total or balance line");
  return problems;
}

/** A row that can go in as it is (the person still decides whether it does). */
export function isImportable(row: ImportRow): boolean {
  return Boolean(row.date && row.amountCents && row.amountCents > 0 && row.direction && row.description.trim());
}

/** A budget sheet's lines: a category name and its budgeted amount, totals left out. */
export function applyBudgetMapping(sheet: Pick<SheetData, "rows" | "rowNumbers">, mapping: SheetMapping): BudgetLine[] {
  const nameCol = mapping.roles.indexOf("category") >= 0 ? mapping.roles.indexOf("category") : mapping.roles.indexOf("description");
  const amountCol = mapping.roles.indexOf("allocated") >= 0 ? mapping.roles.indexOf("allocated") : mapping.roles.indexOf("amount");
  const start = mapping.headerRow + 1;
  const lines = new Map<string, BudgetLine>();
  sheet.rows.slice(start).forEach((cells, i) => {
    const name = clip((cells[nameCol] ?? "").trim(), MAX_CATEGORY_NAME);
    if (!name || SUMMARY_LINE.test(name)) return;
    const amount = amountCol >= 0 ? parseAmount(cells[amountCol] ?? "") : null;
    const key = name.toLowerCase();
    const existing = lines.get(key);
    if (existing) {
      existing.allocatedCents = (existing.allocatedCents ?? 0) + (amount?.cents ?? 0);
      return;
    }
    lines.set(key, {
      key: `b${start + i}`,
      source: `Row ${sheet.rowNumbers[start + i] ?? start + i + 1}`,
      name,
      allocatedCents: amount ? Math.min(amount.cents, MAX_IMPORT_CENTS) : null,
      include: true,
    });
  });
  return [...lines.values()];
}
