import { MAX_LABEL_VALUES, MAX_SAMPLE_ROWS, type SheetSampleData } from "@/lib/ai/finance-sheet";

import type { ColumnRole, SheetMapping } from "./mapping";
import { looksLikeAmounts, looksLikeDates } from "./values";
import type { SheetData } from "./xlsx";

/**
 * What the AI reader sees of a spreadsheet: the first rows (titles and the
 * header live there) and the last few (totals), plus each text column's
 * distinct values, most common first. Enough to map the columns and file
 * every row into a category, at a fraction of the sheet's size.
 */

const HEAD_ROWS = 32;
const TAIL_ROWS = 6;
const MAX_CELL = 200;
/** Values are clipped where the prompt clips them, so labels match back (labelKey clips the same). */
const MAX_VALUE = 80;
const MAX_COLUMNS = 20;
const MAX_VALUE_CHARS = 40_000;

const FIRST: readonly ColumnRole[] = ["description", "category", "counterparty", "type", "notes", "paymentMethod"];

export function buildSheetSample(
  sheet: Pick<SheetData, "name" | "rows">,
  guess: SheetMapping,
  fileName: string,
  today: string,
): SheetSampleData {
  const width = Math.max(1, Math.min(60, sheet.rows.reduce((w, r) => Math.max(w, r.length), 0)));
  const picked = new Set<number>();
  for (let i = 0; i < Math.min(HEAD_ROWS, sheet.rows.length); i++) picked.add(i);
  for (let i = Math.max(0, sheet.rows.length - TAIL_ROWS); i < sheet.rows.length; i++) picked.add(i);
  const rows = [...picked]
    .sort((a, b) => a - b)
    .slice(0, MAX_SAMPLE_ROWS)
    .map((i) => ({ i, cells: sheet.rows[i].slice(0, width).map((c) => c.slice(0, MAX_CELL)) }));

  const body = sheet.rows.slice(guess.headerRow + 1);
  const header = guess.headerRow >= 0 ? sheet.rows[guess.headerRow] : [];
  const order = Array.from({ length: width }, (_, c) => c).sort((a, b) => {
    const rank = (c: number) => {
      const at = FIRST.indexOf(guess.roles[c]);
      return at >= 0 ? at : FIRST.length;
    };
    return rank(a) - rank(b) || a - b;
  });

  const values: SheetSampleData["values"] = [];
  let chars = 0;
  for (const c of order) {
    if (values.length >= MAX_COLUMNS || chars >= MAX_VALUE_CHARS) break;
    const column = body.map((r) => (r[c] ?? "").trim()).filter(Boolean);
    if (column.length === 0 || looksLikeAmounts(column) || looksLikeDates(column, today)) continue;
    const counts = new Map<string, number>();
    for (const v of column) counts.set(v, (counts.get(v) ?? 0) + 1);
    const distinct: string[] = [];
    for (const [v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      if (distinct.length >= MAX_LABEL_VALUES || chars >= MAX_VALUE_CHARS) break;
      const clipped = v.slice(0, MAX_VALUE);
      distinct.push(clipped);
      chars += clipped.length;
    }
    values.push({ column: c, header: (header[c] ?? "").slice(0, MAX_CELL), values: distinct });
  }

  return {
    fileName: fileName.slice(0, 200) || undefined,
    sheetName: sheet.name.slice(0, 200) || undefined,
    width,
    rows,
    values,
  };
}
