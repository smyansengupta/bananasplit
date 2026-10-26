"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  PanelLeft,
  PanelTop,
  Table as TableIcon,
  TableCellsMerge,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
  type IconComponent,
} from "@/components/icons";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Tables in a note: a size picker for inserting one (hover the grid, or
 * type any size up to MAX_ROWS × MAX_COLS), and the row and column tools
 * that show in the toolbar while the cursor is in a table.
 */

export const MAX_ROWS = 50;
export const MAX_COLS = 20;
/** The hover grid's size; bigger tables are typed in. */
const GRID = 8;

export function clampTableSize(rows: number, cols: number): { rows: number; cols: number } {
  const clamp = (n: number, max: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(1, Math.round(n))) : 1;
  return { rows: clamp(rows, MAX_ROWS), cols: clamp(cols, MAX_COLS) };
}

/** "4x6", "4 × 6", "table 4*6": rows by columns, or null. */
export function parseTableSize(query: string): { rows: number; cols: number } | null {
  const m = /^(?:table|grid)?\s*(\d{1,2})\s*[x×*]\s*(\d{1,2})$/i.exec(query.trim());
  if (!m) return null;
  const rows = Number(m[1]);
  const cols = Number(m[2]);
  if (rows < 1 || cols < 1 || rows > MAX_ROWS || cols > MAX_COLS) return null;
  return { rows, cols };
}

export function insertTable(
  editor: Editor,
  size: { rows: number; cols: number },
  withHeaderRow = true,
) {
  const { rows, cols } = clampTableSize(size.rows, size.cols);
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
}

/** The toolbar's Table button: pick a size, then insert. */
export function TableInsertButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ rows: number; cols: number }>({ rows: 3, cols: 3 });
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("3");
  const [header, setHeader] = useState(true);

  function insert(size: { rows: number; cols: number }) {
    insertTable(editor, size, header);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Table"
          aria-label="Table"
          aria-pressed={active}
          onMouseDown={(e) => e.preventDefault()}
          className="aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <TableIcon className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <p className="text-sm font-medium" aria-live="polite">
          {hover.rows} × {hover.cols} table
        </p>
        <div
          role="grid"
          aria-label="Table size"
          className="grid w-max gap-0.5"
          style={{ gridTemplateColumns: `repeat(${GRID}, 1.25rem)` }}
          onMouseLeave={() => setHover({ rows: Number(rows) || 3, cols: Number(cols) || 3 })}
        >
          {Array.from({ length: GRID * GRID }, (_, i) => {
            const r = Math.floor(i / GRID) + 1;
            const c = (i % GRID) + 1;
            const on = r <= hover.rows && c <= hover.cols;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${r} rows by ${c} columns`}
                onMouseEnter={() => setHover({ rows: r, cols: c })}
                onFocus={() => setHover({ rows: r, cols: c })}
                onClick={() => insert({ rows: r, cols: c })}
                className={cn(
                  "size-5 rounded-[3px] border transition-colors",
                  on ? "border-primary bg-primary/20" : "bg-background hover:border-primary/50",
                )}
              />
            );
          })}
        </div>
        <form
          className="flex flex-wrap items-end gap-2 border-t pt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            insert({ rows: Number(rows), cols: Number(cols) });
          }}
        >
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Rows</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_ROWS}
              value={rows}
              onChange={(e) => setRows(e.target.value)}
              className="h-7 w-16"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Columns</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_COLS}
              value={cols}
              onChange={(e) => setCols(e.target.value)}
              className="h-7 w-16"
            />
          </label>
          <Button type="submit" size="sm">
            Insert
          </Button>
          <label className="flex w-full items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={header}
              onChange={(e) => setHeader(e.target.checked)}
              className="accent-primary size-3.5"
            />
            First row is a header
          </label>
        </form>
      </PopoverContent>
    </Popover>
  );
}

interface TableTool {
  label: string;
  icon: IconComponent;
  run: (e: Editor) => boolean;
  can: (e: Editor) => boolean;
  active?: (e: Editor) => boolean;
  destructive?: boolean;
}

const TABLE_GROUPS: TableTool[][] = [
  [
    {
      label: "Add row above",
      icon: BetweenHorizontalStart,
      run: (e) => e.chain().focus().addRowBefore().run(),
      can: (e) => e.can().addRowBefore(),
    },
    {
      label: "Add row below",
      icon: BetweenHorizontalEnd,
      run: (e) => e.chain().focus().addRowAfter().run(),
      can: (e) => e.can().addRowAfter(),
    },
    {
      label: "Delete row",
      icon: TableRowsSplit,
      run: (e) => e.chain().focus().deleteRow().run(),
      can: (e) => e.can().deleteRow(),
    },
  ],
  [
    {
      label: "Add column left",
      icon: BetweenVerticalStart,
      run: (e) => e.chain().focus().addColumnBefore().run(),
      can: (e) => e.can().addColumnBefore(),
    },
    {
      label: "Add column right",
      icon: BetweenVerticalEnd,
      run: (e) => e.chain().focus().addColumnAfter().run(),
      can: (e) => e.can().addColumnAfter(),
    },
    {
      label: "Delete column",
      icon: TableColumnsSplit,
      run: (e) => e.chain().focus().deleteColumn().run(),
      can: (e) => e.can().deleteColumn(),
    },
  ],
  [
    {
      label: "Header row",
      icon: PanelTop,
      run: (e) => e.chain().focus().toggleHeaderRow().run(),
      can: (e) => e.can().toggleHeaderRow(),
      active: (e) => isFirstRowHeader(e),
    },
    {
      label: "Header column",
      icon: PanelLeft,
      run: (e) => e.chain().focus().toggleHeaderColumn().run(),
      can: (e) => e.can().toggleHeaderColumn(),
      active: (e) => isFirstColumnHeader(e),
    },
    {
      label: "Merge or split cells",
      icon: TableCellsMerge,
      run: (e) => e.chain().focus().mergeOrSplit().run(),
      can: (e) => e.can().mergeOrSplit(),
    },
  ],
  [
    {
      label: "Delete table",
      icon: Trash2,
      run: (e) => e.chain().focus().deleteTable().run(),
      can: (e) => e.can().deleteTable(),
      destructive: true,
    },
  ],
];

/** The table around the selection, or null. */
function selectedTable(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") return node;
  }
  return null;
}

function isFirstRowHeader(editor: Editor): boolean {
  const row = selectedTable(editor)?.firstChild;
  if (!row || row.childCount === 0) return false;
  let all = true;
  row.forEach((cell) => {
    if (cell.type.name !== "tableHeader") all = false;
  });
  return all;
}

function isFirstColumnHeader(editor: Editor): boolean {
  const table = selectedTable(editor);
  if (!table || table.childCount === 0) return false;
  let all = true;
  table.forEach((row) => {
    if (row.firstChild?.type.name !== "tableHeader") all = false;
  });
  return all;
}

/** The size of the table the cursor is in, for the tools' label. */
function tableSize(editor: Editor): { rows: number; cols: number } | null {
  const table = selectedTable(editor);
  if (!table) return null;
  let cols = 0;
  table.firstChild?.forEach((cell) => {
    cols += Number(cell.attrs.colspan) || 1;
  });
  return { rows: table.childCount, cols };
}

/** Row and column tools, shown while the cursor is in a table. */
export function TableTools({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      inTable: e.isActive("table"),
      size: tableSize(e),
      can: TABLE_GROUPS.flat().map((t) => t.can(e)),
      active: TABLE_GROUPS.flat().map((t) => (t.active ? t.active(e) : undefined)),
    }),
    equalityFn: (a, b) =>
      b !== null &&
      a.inTable === b.inTable &&
      a.size?.rows === b.size?.rows &&
      a.size?.cols === b.size?.cols &&
      a.can.every((v, i) => v === b.can[i]) &&
      a.active.every((v, i) => v === b.active[i]),
  });
  if (!state.inTable) return null;
  let index = 0;

  return (
    <div
      role="group"
      aria-label="Table"
      className="flex w-full flex-wrap items-center gap-0.5 border-t pt-1"
    >
      <span className="text-muted-foreground px-1.5 text-xs font-medium">
        Table{state.size ? ` · ${state.size.rows} × ${state.size.cols}` : ""}
      </span>
      {TABLE_GROUPS.map((group, g) => (
        <div key={g} className="flex items-center gap-0.5">
          <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
          {group.map((tool) => {
            const i = index++;
            const Icon = tool.icon;
            return (
              <Button
                key={tool.label}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={tool.label}
                aria-label={tool.label}
                aria-pressed={state.active[i]}
                disabled={!state.can[i]}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tool.run(editor)}
                className={cn(
                  "aria-pressed:bg-muted aria-pressed:text-foreground",
                  tool.destructive && "hover:bg-destructive/10 hover:text-destructive",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
