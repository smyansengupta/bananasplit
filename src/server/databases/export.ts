import type { ColumnConfig } from "@/components/databases/column-config";
import { csvRow } from "@/lib/csv";
import type { TxClient } from "@/server/db/context";

import type { PollResults } from "./ballot-results";
import type { DatabaseSource, ViewContext } from "./types";

/**
 * CSV export of a database view (Phase 4a): the same filters, search, date
 * range and sort as the page, the viewer's visible columns (cols=), and the
 * viewer's privacy tier (every page is read through RLS; emails show masked
 * where the tier may not see them). Rows stream in keyset pages, each page in
 * its own short withOrgTx, so a large export never holds one long
 * transaction. Cells go through src/lib/csv.ts (formula-safe).
 */

export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_MAX_ROWS = 50_000;

export function exportColumns(columns: readonly ColumnConfig[], visible: readonly string[]): ColumnConfig[] {
  const shown = new Set(visible);
  return columns.filter((c) => shown.has(c.key) && c.exportable);
}

export function exportHeader(source: DatabaseSource, columns: readonly ColumnConfig[], ctx: ViewContext): string[] {
  return columns.map((c) => (source.csvHeader ? source.csvHeader(c, ctx) : c.label));
}

export type PageRunner = <T>(fn: (db: TxClient) => Promise<T>) => Promise<T>;

/**
 * An async iterator of CSV lines (header first), reading pages through
 * `runPage` (a fresh withOrgTx per page). Stops at EXPORT_MAX_ROWS and says
 * so in a final line.
 */
export async function* csvLines(
  source: DatabaseSource,
  columns: readonly ColumnConfig[],
  ctx: ViewContext,
  query: { where: Record<string, unknown>; orderBy: Record<string, unknown>[] },
  runPage: PageRunner,
): AsyncGenerator<string> {
  yield csvRow(exportHeader(source, columns, ctx));
  let cursor: unknown = undefined;
  let written = 0;
  for (;;) {
    const take = Math.min(EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS - written);
    if (take <= 0) {
      yield csvRow([`Export stopped at ${EXPORT_MAX_ROWS} rows. Narrow the filters to export the rest.`]);
      return;
    }
    const page = await runPage((db) =>
      source.list(db, { where: query.where, orderBy: query.orderBy, take, cursor }, ctx),
    );
    for (const row of page) {
      yield csvRow(columns.map((c) => row.csv[c.key] ?? ""));
    }
    written += page.length;
    if (page.length < take) return;
    cursor = page[page.length - 1].cursor;
  }
}

/** The aggregate results as CSV (members' ballot export): no individual vote. */
export function resultsCsv(results: readonly PollResults[]): string[] {
  const lines = [csvRow(["Poll", "Question", "Option", "Votes", "Share of ballots", "First choice", "Borda", "Ballots"])];
  for (const r of results) {
    for (const q of r.questions) {
      for (const o of q.options) {
        lines.push(
          csvRow([
            r.poll.title,
            q.label,
            o.label,
            o.suppressed ? `<${r.minCellSize}` : o.votes,
            o.share === null ? "" : `${Math.round(o.share * 1000) / 10}%`,
            o.suppressed ? "" : o.firstChoice,
            o.suppressed ? "" : o.borda,
            q.ballots,
          ]),
        );
      }
    }
  }
  return lines;
}
