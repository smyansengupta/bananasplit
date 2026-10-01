import { isZip, readXlsx, SpreadsheetError, type SheetData } from "./xlsx";

/**
 * Whatever a treasurer has, as rows of cells: a CSV or TSV export, an Excel
 * workbook, or rows copied out of Google Sheets or Excel and pasted (which
 * arrive tab-separated). Parsed in the browser, so the file itself never
 * leaves the member's computer; only the rows they import do. PDFs and
 * pictures are not tables: the AI reader handles those (see
 * src/server/ai/finance-import.ts).
 */

export { SpreadsheetError, type SheetData };

/** Files read as tables here. */
export const TABLE_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".xlsm"] as const;
/** Files only an AI model can read. */
export const DOCUMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_COLS = 60;

/** Comma, tab, semicolon or pipe: whichever splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = 0;
  for (const d of ["\t", ",", ";", "|"]) {
    const counts = lines.map((l) => splitQuoted(l, d).length);
    const most = Math.max(0, ...counts);
    if (most < 2) continue;
    const consistent = counts.filter((c) => c === most).length;
    const score = consistent * most;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** One line split on `delimiter`, respecting quotes (for delimiter detection only). */
function splitQuoted(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === delimiter && !quoted) {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/**
 * RFC 4180 with any single-character delimiter: quoted fields, doubled
 * quotes, CRLF or LF, a leading BOM. Empty rows are dropped; each kept row
 * remembers its line number so the review can say "row 12".
 */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): SheetData {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  let truncated = false;
  let full = false;
  const finish = () => {
    row.push(field);
    field = "";
    if (row.some((f) => f.trim() !== "")) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        full = true;
      } else {
        if (row.length > MAX_COLS) truncated = true;
        rows.push(trimTrailing(row.slice(0, MAX_COLS)));
        rowNumbers.push(rowStart);
      }
    }
    row = [];
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length && !full; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finish();
      line++;
      rowStart = line;
    } else field += c;
  }
  if (!full) finish();
  return { name: "Sheet 1", rows: rows.map((r) => r.map(cleanCell)), rowNumbers, hidden: false, truncated };
}

function trimTrailing(row: string[]): string[] {
  let end = row.length;
  while (end > 0 && row[end - 1].trim() === "") end--;
  return row.slice(0, end);
}

/** A spreadsheet export may prefix text with ' (the formula guard): strip it, and trim. */
function cleanCell(value: string): string {
  const v = value.replace(/\r\n?/g, "\n").trim();
  return v.startsWith("'") ? v.slice(1) : v;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

/** True for a file the AI reader takes (a PDF or a picture) rather than a table. */
export function isDocumentFile(fileName: string): boolean {
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/**
 * A table file's sheets. Excel workbooks are recognized by their bytes,
 * whatever the name says; everything else must decode as UTF-8 text (or
 * Windows-1252, the other encoding Excel saves CSVs in).
 */
export function readTableFile(fileName: string, bytes: Uint8Array): SheetData[] {
  const ext = extensionOf(fileName);
  if (isZip(bytes)) {
    const sheets = readXlsx(bytes, { maxRows: MAX_ROWS, maxCols: MAX_COLS }).filter((s) => s.rows.length > 0);
    if (sheets.length === 0) throw new SpreadsheetError("That workbook has no rows to import.");
    return sheets;
  }
  if (ext === ".xls") {
    throw new SpreadsheetError("That's the old Excel format (.xls). Open it in Excel or Google Sheets and save it as .xlsx or CSV.");
  }
  if (ext === ".numbers" || ext === ".ods") {
    throw new SpreadsheetError("Export it from your spreadsheet app as .xlsx or CSV first.");
  }
  if (bytes.length > MAX_TEXT_BYTES) throw new SpreadsheetError("That file is too large to import (8 MB at most).");
  const text = decodeText(bytes);
  if (text === null) throw new SpreadsheetError("That file isn't a spreadsheet this can read. Try CSV or .xlsx.");
  const sheet = parseDelimited(text, ext === ".tsv" ? "\t" : undefined);
  if (sheet.rows.length === 0) throw new SpreadsheetError("That file has no rows to import.");
  return [{ ...sheet, name: fileName.replace(/\.[^.]+$/, "") || "Sheet 1" }];
}

/** UTF-8 text, or Windows-1252 when it isn't valid UTF-8; null for binary. */
export function decodeText(bytes: Uint8Array): string | null {
  const sample = bytes.subarray(0, 4096);
  if (sample.some((b) => b === 0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Rows pasted from Google Sheets or Excel (tab-separated), or typed CSV. */
export function readPastedTable(text: string): SheetData {
  return { ...parseDelimited(text), name: "Pasted rows" };
}
