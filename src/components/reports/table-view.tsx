import type { ReactNode } from "react";

/**
 * The table twin of a chart: every plotted value is readable without the
 * chart or its tooltip. Collapsed by default (a native <details>, no JS).
 */
export function TableView({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: { key: string; cells: Record<string, ReactNode> }[];
}) {
  if (rows.length === 0) return null;
  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs select-none">
        Show as table
      </summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-2 py-1.5 font-medium ${c.numeric ? "text-right" : ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1.5 ${c.numeric ? "text-right tabular-nums" : ""}`}
                  >
                    {r.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
