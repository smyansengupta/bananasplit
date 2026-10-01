import { z } from "zod";

import { TransactionKind } from "@/generated/prisma/enums";
import {
  AMOUNT_SIGNS,
  COLUMN_ROLES,
  inferKind,
  kindFits,
  MAX_CATEGORY_NAME,
  MAX_DESCRIPTION,
  type BudgetLine,
  type ColumnRole,
  type ImportRow,
  type SheetMapping,
} from "@/lib/finance/import/mapping";
import { MAX_IMPORT_CENTS, parseAmount, parseDate } from "@/lib/finance/import/values";

/**
 * The AI reader's answers for finance imports, and how they're cleaned up.
 * Two shapes: for a spreadsheet, a column mapping plus labels for its
 * distinct values (so a 2,000-row ledger costs one short request, and the
 * rows are mapped in the browser); for a PDF, a picture or pasted text, the
 * records themselves. Client-safe: the review uses the same types.
 */

export const IMPORT_KINDS = [
  TransactionKind.EXPENSE,
  TransactionKind.SPONSORSHIP,
  TransactionKind.OTHER_INCOME,
  TransactionKind.ALLOCATION,
  TransactionKind.ADJUSTMENT,
] as const;

const column = z.number().int().nullable();

export const SheetReadOutput = z.object({
  sheetKind: z.enum(["transactions", "budget", "other"]),
  headerRow: z.number().int().nullable(),
  columns: z.object({
    date: column,
    description: column,
    amount: column,
    moneyIn: column,
    moneyOut: column,
    type: column,
    category: column,
    counterparty: column,
    paymentMethod: column,
    allocated: column,
  }),
  notesColumns: z.array(z.number().int()),
  amountSign: z.enum(AMOUNT_SIGNS),
  typeIn: z.array(z.string()),
  typeOut: z.array(z.string()),
  dateOrder: z.enum(["MDY", "DMY", "YMD"]),
  labels: z.array(
    z.object({
      column: z.number().int(),
      value: z.string(),
      category: z.string().nullable(),
      kind: z.enum(IMPORT_KINDS).nullable(),
    }),
  ),
  notes: z.array(z.string()),
});
export type SheetReadOutputData = z.infer<typeof SheetReadOutput>;

export const DocumentReadOutput = z.object({
  sheetKind: z.enum(["transactions", "budget", "other"]),
  records: z.array(
    z.object({
      date: z.string().nullable(),
      description: z.string(),
      amount: z.string(),
      direction: z.enum(["IN", "OUT"]),
      kind: z.enum(IMPORT_KINDS).nullable(),
      category: z.string().nullable(),
      counterparty: z.string().nullable(),
    }),
  ),
  budget: z.array(z.object({ category: z.string(), allocated: z.string() })),
  notes: z.array(z.string()),
});
export type DocumentReadOutputData = z.infer<typeof DocumentReadOutput>;

/** What the browser sends about a spreadsheet: a sample of rows and each text column's distinct values. */
export const SheetSample = z.object({
  fileName: z.string().max(200).optional(),
  sheetName: z.string().max(200).optional(),
  width: z.number().int().min(1).max(60),
  rows: z
    .array(z.object({ i: z.number().int().min(0), cells: z.array(z.string().max(200)).max(60) }))
    .min(1)
    .max(60),
  values: z
    .array(
      z.object({
        column: z.number().int().min(0).max(59),
        header: z.string().max(200),
        values: z.array(z.string().max(120)).max(150),
      }),
    )
    .max(20),
});
export type SheetSampleData = z.infer<typeof SheetSample>;

export const MAX_SAMPLE_ROWS = 40;
export const MAX_LABEL_VALUES = 120;
/** The most pasted text one read takes. */
export const MAX_IMPORT_TEXT = 60_000;

export interface AiLabel {
  column: number;
  value: string;
  category: string | null;
  kind: TransactionKind | null;
}

export interface SheetRead {
  /** null when the model says the sheet is neither a ledger nor a budget. */
  mapping: SheetMapping | null;
  labels: AiLabel[];
  notes: string[];
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const cleanNotes = (notes: readonly string[]) => notes.map((n) => clip(n, 300)).filter(Boolean).slice(0, 8);

/** A category name the model proposed, tidied: short, single-line, or null. */
export function cleanCategory(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = clip(name.replace(/[<>]/g, ""), MAX_CATEGORY_NAME);
  return t && !/^(none|null|n\/a|unknown|other\/unknown)$/i.test(t) ? t : null;
}

/**
 * The model's mapping, checked against what was sent: columns must exist,
 * each role is held once, the header must be a row that was sent, and
 * labels must be for values that were sent (anything else is dropped).
 */
export function normalizeSheetRead(out: SheetReadOutputData, sample: SheetSampleData): SheetRead {
  const notes = cleanNotes(out.notes);
  const sent = new Set(sample.rows.map((r) => r.i));
  const roles: ColumnRole[] = Array.from({ length: sample.width }, () => "ignore");
  const assigned = new Set<ColumnRole>();
  for (const role of COLUMN_ROLES) {
    if (role === "ignore" || role === "notes") continue;
    const col = out.columns[role as keyof typeof out.columns];
    if (col === null || col === undefined || col < 0 || col >= sample.width || roles[col] !== "ignore") continue;
    roles[col] = role;
    assigned.add(role);
  }
  for (const col of out.notesColumns) if (col >= 0 && col < sample.width && roles[col] === "ignore") roles[col] = "notes";

  const values = new Map(sample.values.map((v) => [v.column, new Set(v.values.map((x) => x.trim().toLowerCase()))]));
  const labels: AiLabel[] = [];
  for (const l of out.labels.slice(0, 600)) {
    if (!values.get(l.column)?.has(l.value.trim().toLowerCase())) continue;
    labels.push({ column: l.column, value: l.value.trim(), category: cleanCategory(l.category), kind: l.kind ?? null });
  }

  if (out.sheetKind === "other" || (!assigned.has("amount") && !assigned.has("moneyIn") && !assigned.has("moneyOut") && !assigned.has("allocated"))) {
    return { mapping: null, labels, notes };
  }
  const headerRow = out.headerRow !== null && sent.has(out.headerRow) ? out.headerRow : -1;
  const kind = out.sheetKind === "budget" ? "budget" : "transactions";
  return {
    mapping: {
      kind,
      headerRow,
      roles,
      amountSign: out.amountSign,
      typeIn: out.typeIn.map((v) => clip(v, 60).toLowerCase()).filter(Boolean).slice(0, 20),
      typeOut: out.typeOut.map((v) => clip(v, 60).toLowerCase()).filter(Boolean).slice(0, 20),
      dateOrder: out.dateOrder,
    },
    labels,
    notes,
  };
}

export interface DocumentRead {
  kind: "transactions" | "budget";
  rows: ImportRow[];
  budget: BudgetLine[];
  notes: string[];
}

const MAX_RECORDS = 300;

/** The records a model read out of a PDF, picture or pasted text, as review rows. */
export function normalizeDocumentRead(out: DocumentReadOutputData, today: string): DocumentRead {
  const notes = cleanNotes(out.notes);
  if (out.sheetKind === "budget" && out.budget.length > 0) {
    const seen = new Set<string>();
    const budget: BudgetLine[] = [];
    out.budget.slice(0, 200).forEach((line, i) => {
      const name = cleanCategory(line.category);
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      const amount = parseAmount(line.allocated);
      budget.push({
        key: `d${i}`,
        source: `Line ${i + 1}`,
        name,
        allocatedCents: amount ? Math.min(amount.cents, MAX_IMPORT_CENTS) : null,
        include: true,
      });
    });
    return { kind: "budget", rows: [], budget, notes };
  }
  const rows: ImportRow[] = out.records.slice(0, MAX_RECORDS).map((r, i) => {
    const amount = parseAmount(r.amount);
    const amountCents = amount && amount.cents > 0 && amount.cents <= MAX_IMPORT_CENTS ? amount.cents : null;
    const date = r.date ? parseDate(r.date, { order: "YMD", today }) : null;
    const description = clip(r.description, MAX_DESCRIPTION) || "Imported transaction";
    const category = cleanCategory(r.category);
    const counterparty = r.counterparty ? clip(r.counterparty, 200) || null : null;
    const kind =
      r.kind && kindFits(r.kind, r.direction)
        ? r.kind
        : inferKind(r.direction, [description, category ?? "", counterparty ?? ""].join(" "));
    return {
      key: `d${i}`,
      source: `Item ${i + 1}`,
      date,
      description,
      amountCents,
      direction: r.direction,
      kind,
      category,
      counterparty,
      paymentMethod: null,
      include: Boolean(date && amountCents),
    };
  });
  return { kind: "transactions", rows, budget: [], notes };
}
