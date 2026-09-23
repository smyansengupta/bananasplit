/**
 * CSV output that is safe to open in a spreadsheet (0A Fix 10).
 *
 * - Formula neutralization: a text cell that starts with =, +, -, @, a tab
 *   or a carriage return is prefixed with a single quote, so Excel, Sheets
 *   and LibreOffice show it as text instead of evaluating it (CSV injection).
 *   Plain numbers ("-12.50") are left alone: they cannot be formulas.
 * - Quoting: a cell containing a quote, comma, CR or LF is wrapped in quotes,
 *   with inner quotes doubled (RFC 4180). Rows end with CRLF.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const NEEDS_QUOTES = /[",\r\n]/;

/** The text of one cell, neutralized and quoted as needed. */
export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) {
    text = "";
  } else if (value instanceof Date) {
    text = Number.isNaN(value.getTime()) ? "" : value.toISOString();
  } else if (typeof value === "number" || typeof value === "bigint") {
    text = String(value);
  } else if (typeof value === "boolean") {
    text = value ? "true" : "false";
  } else if (typeof value === "string") {
    text = value;
    if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
      text = `'${text}`;
    }
  } else {
    text = JSON.stringify(value) ?? "";
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line (no line terminator). */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/**
 * A whole CSV document: an optional header row, then the rows, CRLF-separated
 * with a trailing CRLF. `bom` prepends a UTF-8 byte-order mark so Excel reads
 * non-ASCII names correctly.
 */
export function toCsv(
  rows: readonly (readonly unknown[])[],
  options: { header?: readonly string[]; bom?: boolean } = {},
): string {
  const lines = options.header ? [csvRow(options.header), ...rows.map(csvRow)] : rows.map(csvRow);
  const body = lines.length ? `${lines.join("\r\n")}\r\n` : "";
  return options.bom ? `﻿${body}` : body;
}

/**
 * A Content-Disposition value for a CSV download. The ASCII fallback keeps
 * only safe characters; filename* carries the UTF-8 name (RFC 5987/6266).
 */
export function csvContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "export.csv";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
