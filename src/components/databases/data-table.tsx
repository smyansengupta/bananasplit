"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Columns3,
  Database,
  Filter,
  Loader2,
  X,
} from "@/components/icons";
import { useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { chipClass } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { CellView } from "./cell";
import type { ColumnView, RowView } from "./column-config";
import { TableFrame } from "./table-frame";
import { addToList, removeFromList, useViewParams, withoutFilter } from "./view-params";

/**
 * The generic database table (Phase 4a). Every control writes the URL in
 * the shared grammar and the server page re-queries: sorting, filtering,
 * search, the date range, column visibility and pagination all run
 * server-side through the allowlisted query builder. No client-side
 * processing of the table. The toolbar is the everyday controls only;
 * Export CSV and the admin pages live in the page header's "…" menu
 * (DatabaseMenu).
 */

export interface AppliedFilterView {
  col: string;
  op: string;
  value: string;
  isDefault?: boolean;
}

export interface DataTableProps {
  columns: ColumnView[];
  rows: RowView[];
  total: number;
  page: number;
  size: number;
  sort: { col: string; dir: "asc" | "desc" };
  filters: AppliedFilterView[];
  rejected: { part: string; reason: string }[];
  q?: string;
  from?: string;
  to?: string;
  /** Label of the column ?from= / ?to= filter, when the database has one. */
  dateLabel?: string;
  emptyTitle?: string;
  selectedRowId?: string;
}

const OP_LABELS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  gt: "after / more than",
  gte: "on or after / at least",
  lt: "before / less than",
  lte: "on or before / at most",
  contains: "contains",
  in: "is any of",
  isnull: "is empty",
};

/** The date range's two inputs: 40px pills like the rest of the toolbar. */
const DATE_INPUT =
  "w-40 rounded-full px-4 tabular-nums [&::-webkit-calendar-picker-indicator]:opacity-60";

const SHORT_OPS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  in: "in",
  isnull: "empty",
};

function valueLabel(column: ColumnView | undefined, op: string, value: string): string {
  if (op === "isnull") return value === "true" ? "yes" : "no";
  const opts = column?.options;
  const one = (v: string) => opts?.find((o) => o.value === v)?.label ?? v;
  if (column?.type === "boolean") return value === "true" ? "yes" : "no";
  return value.split(",").map(one).join(", ");
}

function FilterChip({
  filter,
  column,
  onRemove,
}: {
  filter: AppliedFilterView;
  column?: ColumnView;
  onRemove: () => void;
}) {
  // The shared chip shape; a default filter keeps the outline, one you added is filled.
  return (
    <span
      className={cn(
        chipClass(false),
        "text-foreground hover:text-foreground gap-1 pr-1 hover:bg-transparent",
        !filter.isDefault && "bg-muted hover:bg-muted border-transparent",
      )}
    >
      <span className="font-medium">{column?.label ?? filter.col}</span>
      {filter.op === "isnull" ? (
        <span className="text-muted-foreground">
          {filter.value === "false" ? "is set" : "is empty"}
        </span>
      ) : (
        <>
          <span className="text-muted-foreground">{SHORT_OPS[filter.op] ?? filter.op}</span>
          <span>{valueLabel(column, filter.op, filter.value)}</span>
        </>
      )}
      {filter.isDefault && <span className="text-muted-foreground">(default)</span>}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground hover:bg-background ml-0.5 grid size-6 place-items-center rounded-full"
        aria-label={`Remove filter ${column?.label ?? filter.col}`}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}

function FilterBuilder({
  columns,
  onAdd,
}: {
  columns: ColumnView[];
  onAdd: (raw: string) => void;
}) {
  const filterable = columns.filter((c) => c.filterable && c.ops.length > 0);
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState(filterable[0]?.key ?? "");
  const column = filterable.find((c) => c.key === col);
  const [op, setOp] = useState(column?.ops[0] ?? "eq");
  const [value, setValue] = useState("");

  const pickColumn = (key: string) => {
    const c = filterable.find((x) => x.key === key);
    setCol(key);
    if (c && !c.ops.includes(op)) setOp(c.ops[0]);
    setValue("");
  };

  if (filterable.length === 0) return null;
  const type = column?.type;
  const isDate = type === "date" || type === "datetime";
  const isBool = type === "boolean" || op === "isnull";
  const hasOptions = Boolean(column?.options?.length) && op !== "contains";

  const submit = () => {
    const v = isBool && !value ? "true" : value.trim();
    if (!col || !op || !v) return;
    onAdd(`${col}:${op}:${v}`);
    setOpen(false);
    setValue("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Filter aria-hidden="true" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3.5 p-4">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor="db-filter-col">
            Column
          </label>
          <Select value={col} onValueChange={pickColumn}>
            <SelectTrigger id="db-filter-col" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterable.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor="db-filter-op">
            Condition
          </label>
          <Select value={op} onValueChange={setOp}>
            <SelectTrigger id="db-filter-op" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(column?.ops ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {OP_LABELS[o] ?? o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor="db-filter-value">
            Value
          </label>
          {isBool ? (
            <Select value={value || "true"} onValueChange={setValue}>
              <SelectTrigger id="db-filter-value" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          ) : hasOptions && op !== "in" ? (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger id="db-filter-value" className="w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {column?.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : hasOptions && op === "in" ? (
            <div className="bg-muted/60 rounded-field max-h-44 space-y-1.5 overflow-y-auto p-3">
              {column?.options?.map((o) => {
                const list = value.split(",").filter(Boolean);
                const checked = list.includes(o.value);
                return (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setValue(
                          (checked ? list.filter((v) => v !== o.value) : [...list, o.value]).join(
                            ",",
                          ),
                        )
                      }
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
          ) : (
            <Input
              id="db-filter-value"
              type={isDate ? "date" : type === "number" ? "number" : "text"}
              value={value}
              placeholder={op === "in" ? "a,b,c" : ""}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          )}
        </div>
        <Button className="w-full" onClick={submit}>
          Add filter
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  if (dir === "asc") return <ArrowUp className="size-3.5" aria-hidden="true" />;
  if (dir === "desc") return <ArrowDown className="size-3.5" aria-hidden="true" />;
  return (
    <ArrowUpDown
      className="size-3.5 opacity-0 transition-opacity group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60"
      aria-hidden="true"
    />
  );
}

export function DataTable(props: DataTableProps) {
  const { columns, rows, total, page, size, sort, filters, rejected } = props;
  const view = useViewParams();
  const visible = columns.filter((c) => c.visible);
  const [search, setSearch] = useState(props.q ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const byKey = new Map(columns.map((c) => [c.key, c]));

  // "Clear all" (or any other change that drops ?q=) empties the box.
  const [seenQ, setSeenQ] = useState(props.q);
  if (seenQ !== props.q) {
    setSeenQ(props.q);
    if (!props.q) setSearch("");
  }

  const onSearch = (value: string) => {
    setSearch(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      view.update((p) => {
        if (value.trim()) p.set("q", value.trim());
        else p.delete("q");
      });
    }, 300);
  };

  const toggleSort = (key: string) => {
    view.update(
      (p) => {
        if (sort.col !== key) p.set("sort", `${key}:asc`);
        else if (sort.dir === "asc") p.set("sort", `${key}:desc`);
        else p.set("sort", `${key}:asc`);
      },
      { keepPage: false },
    );
  };

  const setColumns = (key: string, on: boolean) => {
    view.update(
      (p) => {
        const current = columns.filter((c) => c.visible).map((c) => c.key);
        const next = on ? [...current, key] : current.filter((k) => k !== key);
        const ordered = columns.map((c) => c.key).filter((k) => next.includes(k));
        p.set("cols", ordered.join(","));
      },
      { keepPage: true },
    );
  };

  const removeFilter = (f: AppliedFilterView) => {
    view.update((p) => {
      if (f.isDefault) addToList(p, "nd", f.col);
      else withoutFilter(p, `${f.col}:${f.op}:${f.value}`);
    });
  };

  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);

  const filtered = filters.some((f) => !f.isDefault) || Boolean(props.q || props.from || props.to);
  const clearAll = () =>
    view.update((p) => {
      p.delete("f");
      p.delete("q");
      p.delete("from");
      p.delete("to");
      setSearch("");
    });
  const openRow = (id: string) =>
    view.update((p) => p.set("row", id), { keepPage: true, push: true });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={search}
          onValueChange={onSearch}
          placeholder="Search…"
          aria-label="Search this database"
        />
        <FilterBuilder
          columns={columns}
          onAdd={(raw) =>
            view.update((p) => {
              const col = raw.slice(0, raw.indexOf(":"));
              removeFromList(p, "nd", col);
              if (!p.getAll("f").includes(raw)) p.append("f", raw);
            })
          }
        />
        {props.dateLabel && (
          <div
            role="group"
            aria-label={`${props.dateLabel} range`}
            className="flex items-center gap-2"
          >
            <span className="text-muted-foreground text-[13px]">{props.dateLabel}</span>
            <Input
              type="date"
              aria-label={`${props.dateLabel} from`}
              title={`${props.dateLabel} from`}
              defaultValue={props.from ?? ""}
              key={`from-${props.from ?? ""}`}
              onChange={(e) =>
                view.update((p) =>
                  e.target.value ? p.set("from", e.target.value) : p.delete("from"),
                )
              }
              className={DATE_INPUT}
            />
            <span className="text-muted-foreground text-sm" aria-hidden="true">
              –
            </span>
            <Input
              type="date"
              aria-label={`${props.dateLabel} to`}
              title={`${props.dateLabel} to`}
              defaultValue={props.to ?? ""}
              key={`to-${props.to ?? ""}`}
              onChange={(e) =>
                view.update((p) => (e.target.value ? p.set("to", e.target.value) : p.delete("to")))
              }
              className={DATE_INPUT}
            />
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3 aria-hidden="true" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={c.visible}
                disabled={c.visible && visible.length === 1}
                onCheckedChange={(on) => setColumns(c.key, Boolean(on))}
                onSelect={(e) => e.preventDefault()}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {view.pending && (
          <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Loading" />
        )}
      </div>

      {(filters.length > 0 || props.q || props.from || props.to) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <FilterChip
              key={`${f.col}:${f.op}:${f.value}:${f.isDefault ? "d" : ""}`}
              filter={f}
              column={byKey.get(f.col)}
              onRemove={() => removeFilter(f)}
            />
          ))}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </div>
      )}

      {rejected.length > 0 && (
        <p role="status" className="bg-muted/60 rounded-tile flex items-start gap-2 p-3 text-sm">
          <CircleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Ignored: {rejected.map((r) => `${r.part} (${r.reason})`).join("; ")}</span>
        </p>
      )}

      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              {visible.map((c) => {
                const right = c.align === "right";
                const sorted = sort.col === c.key;
                return (
                  <TableHead key={c.key} className={cn(right && "text-right tabular-nums")}>
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "group/sort hover:text-foreground focus-visible:outline-foreground inline-flex items-center gap-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
                          right && "flex-row-reverse",
                          sorted && "text-foreground",
                        )}
                        aria-label={`Sort by ${c.label}`}
                      >
                        {c.label}
                        <SortIcon dir={sorted ? sort.dir : null} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visible.length} className="whitespace-normal">
                  <EmptyState
                    icon={Database}
                    title={props.emptyTitle ?? "No rows match this view"}
                    description={
                      filtered
                        ? "Try another search or date range, or clear the filters."
                        : "Rows show up here as they're added."
                    }
                    action={
                      filtered ? (
                        <Button variant="outline" onClick={clearAll}>
                          Clear all
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  data-state={props.selectedRowId === r.id ? "selected" : undefined}
                  className={cn(
                    "focus-visible:outline-foreground cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2",
                    r.dim && "opacity-60",
                  )}
                  onClick={() => openRow(r.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openRow(r.id);
                  }}
                >
                  {visible.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "max-w-72 whitespace-normal",
                        c.align === "right" && "text-right tabular-nums",
                        (c.type === "datetime" || c.type === "date") &&
                          "whitespace-nowrap tabular-nums",
                        (c.type === "text" || c.type === "person" || c.type === "relation") &&
                          "min-w-36",
                        // Room for a few chips side by side, so rows stay one line tall.
                        c.type === "multiselect" && "min-w-60",
                      )}
                    >
                      <CellView cell={r.cells[c.key] ?? null} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableFrame>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground tabular-nums">
          {total === 0
            ? "No rows"
            : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(size)}
            onValueChange={(v) =>
              view.update((p) => (v === "50" ? p.delete("size") : p.set("size", v)))
            }
          >
            <SelectTrigger size="sm" className="w-28 rounded-full" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() =>
              view.update(
                (p) => (page - 1 <= 1 ? p.delete("page") : p.set("page", String(page - 1))),
                { keepPage: true },
              )
            }
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-12 text-center tabular-nums">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages}
            onClick={() => view.update((p) => p.set("page", String(page + 1)), { keepPage: true })}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
