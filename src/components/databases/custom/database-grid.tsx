"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUpAZ,
  Check,
  CircleAlert,
  Database,
  Download,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  SearchX,
  Settings2,
  Shapes,
  Trash2,
} from "@/components/icons";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
  addChoiceAction,
  addFieldAction,
  createRecordAction,
  deleteFieldAction,
  loadRecordsAction,
  moveFieldAction,
  purgeRecordsAction,
  restoreRecordsAction,
  trashRecordsAction,
  updateCellAction,
  updateFieldAction,
} from "@/app/app/[orgSlug]/databases/custom-actions";
import { BackLink } from "@/components/back-link";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import {
  choicesVersion,
  displayText,
  FIELD_TYPE_META,
  FIELD_TYPES,
  hasChoices,
  type Choice,
  type FieldDef,
  type FieldType,
  type StoredValue,
} from "@/lib/databases/fields";
import { cn } from "@/lib/utils";
import type { CustomDatabase, CustomRecord } from "@/server/databases/custom";

import { TableFrame } from "../table-frame";
import { CellEditor, type Member } from "./cell-editor";
import { ChoicesDialog, FieldNameDialog, NewFieldPopover } from "./field-dialogs";
import { FieldIcon } from "./field-icon";
import { DatabaseSettingsDialog } from "./settings-dialog";

/**
 * A club-made database as a spreadsheet you edit in place. Every change
 * saves on its own (each cell is its own small save, src/server/databases/
 * custom.ts) and the header says when everything is saved. Owners and
 * admins also shape it: fields, choices, settings, the trash.
 *
 * Rows arrive a page at a time (oldest first; "Load more" for the next
 * page) and search runs on the server, so every row of a big database can
 * be found and edited without loading all of it.
 */

const WIDTH: Record<FieldType, number> = {
  TEXT: 200,
  LONG_TEXT: 260,
  NUMBER: 120,
  CURRENCY: 130,
  DATE: 160,
  CHECKBOX: 96,
  SELECT: 170,
  MULTI_SELECT: 220,
  MEMBER: 180,
  EMAIL: 220,
  PHONE: 160,
  URL: 200,
};

/** A row's ••• : quiet until the row is hovered or focused (always shown on touch). */
const ROW_MENU =
  "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100";

/** Rows the export asks for at a time. */
const EXPORT_PAGE = 2_000;

/** Wait for a pause in typing before searching: each search is a trip to the server. */
const SEARCH_AFTER_MS = 300;

type Sort = { fieldId: string; dir: 1 | -1 } | null;

// Fixed, not the browser's: the server renders the same text.
const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
const formatCount = (n: number) => n.toLocaleString("en-US");

function withValue(values: Record<string, unknown>, fieldId: string, value: StoredValue | null) {
  const next = { ...values };
  if (value === null) delete next[fieldId];
  else next[fieldId] = value;
  return next;
}

function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The server's order: oldest first, or most recently deleted first in the trash. */
function inOrder(a: CustomRecord, b: CustomRecord, trash: boolean): number {
  const [x, y] = trash ? [b.deletedAt ?? "", a.deletedAt ?? ""] : [a.createdAt, b.createdAt];
  if (x !== y) return x < y ? -1 : 1;
  if (a.id === b.id) return 0;
  return (a.id < b.id ? -1 : 1) * (trash ? -1 : 1);
}

/** Rows already shown plus a newly loaded page, each once, in the server's order. */
function mergeRows(current: CustomRecord[], page: CustomRecord[], trash: boolean) {
  const fresh = new Set(page.map((r) => r.id));
  return [...current.filter((r) => !fresh.has(r.id)), ...page].sort((a, b) => inOrder(a, b, trash));
}

function sortRows(
  rows: CustomRecord[],
  fields: FieldDef[],
  sort: Sort,
  memberNames: ReadonlyMap<string, string>,
): CustomRecord[] {
  const f = sort && fields.find((x) => x.id === sort.fieldId);
  if (!sort || !f) return rows;
  const numeric = f.type === "NUMBER" || f.type === "CURRENCY";
  // Each row's text once, rather than twice per comparison.
  const keys = new Map(rows.map((r) => [r.id, displayText(f, r.values[f.id], memberNames)]));
  return [...rows].sort((a, b) => {
    const av = a.values[f.id];
    const bv = b.values[f.id];
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (numeric) return ((av as number) - (bv as number)) * sort.dir;
    return collator.compare(keys.get(a.id)!, keys.get(b.id)!) * sort.dir;
  });
}

/** What a row can ask of the grid. Stable, so a row only re-renders when its own data changes. */
interface RowActions {
  save: (recordId: string, fieldId: string, value: StoredValue | null) => void;
  addChoice: (fieldId: string, label: string) => Promise<Choice | null>;
  select: (recordId: string, selected: boolean) => void;
  expand: (recordId: string) => void;
  trash: (recordId: string) => void;
  restore: (recordId: string) => void;
  purge: (recordId: string) => void;
}

export function DatabaseGrid({
  orgId,
  orgSlug,
  database,
  members,
  trash,
  timezone,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  database: CustomDatabase;
  members: Member[];
  trash: boolean;
  /** The club's time zone, for when rows were deleted (the same on the server and in the browser). */
  timezone: string;
  /** A Personal space: settings don't ask who can see or edit it. */
  personal?: boolean;
}) {
  const [confirmEl, confirm] = useConfirm();
  const [fields, setFields] = useState(database.fields);
  const [records, setRecords] = useState(database.records);
  const [next, setNext] = useState(database.next);
  const [total, setTotal] = useState(database.total);
  const [trashCount, setTrashCount] = useState(database.trashCount);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** The search the loaded rows match ("" for none). */
  const [searchedFor, setSearchedFor] = useState("");
  const [loading, setLoading] = useState<"search" | "more" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<FieldDef | null>(null);
  const [editingChoices, setEditingChoices] = useState<FieldDef | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  /** Bumped by every new list (a search, a reload): an older answer is dropped. */
  const listSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Cell saves on their way, by "record:field": the latest one, and what to go back to. */
  const inflight = useRef(new Map<string, { seq: number; before: unknown }>());

  // A refresh (the settings changed, another page) replaces the local copy:
  // reset during render when the server's data changes.
  const [fromServer, setFromServer] = useState(database);
  if (fromServer !== database) {
    setFromServer(database);
    setFields(database.fields);
    setRecords(database.records);
    setNext(database.next);
    setTotal(database.total);
    setTrashCount(database.trashCount);
    setQuery("");
    setSearchedFor("");
    setSelected(new Set());
  }

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const primary = fields.find((f) => f.isPrimary) ?? fields[0];
  const canEdit = database.canEdit && !trash;
  const base = `/app/${orgSlug}/databases/${database.key}`;
  const shown = useMemo(
    () => sortRows(records, fields, sort, memberNames),
    [records, fields, sort, memberNames],
  );
  const formatDeleted = useMemo(() => {
    const zone = timezone || "UTC";
    return (iso: string) => format(new TZDate(iso, zone), "MMM d, yyyy, h:mm a");
  }, [timezone]);

  async function track<T>(work: Promise<{ error?: string; data?: T }>): Promise<T | undefined> {
    setPending((n) => n + 1);
    try {
      const result = await work;
      if (result.error) {
        setFailed(result.error);
        toast({ title: "Not saved", description: result.error });
        return undefined;
      }
      setFailed(null);
      return result.data;
    } finally {
      setPending((n) => n - 1);
    }
  }

  function setCell(recordId: string, fieldId: string, value: StoredValue | null) {
    setRecords((rs) =>
      rs.map((r) =>
        r.id === recordId ? { ...r, values: withValue(r.values, fieldId, value) } : r,
      ),
    );
  }

  async function saveCell(recordId: string, fieldId: string, value: StoredValue | null) {
    const key = `${recordId}:${fieldId}`;
    const earlier = inflight.current.get(key);
    const seq = (earlier?.seq ?? 0) + 1;
    // What this cell goes back to if the save fails: the last value the server has.
    const before = earlier
      ? earlier.before
      : records.find((r) => r.id === recordId)?.values[fieldId];
    inflight.current.set(key, { seq, before });
    setCell(recordId, fieldId, value);
    const saved = await track(updateCellAction(orgId, recordId, fieldId, value));
    const latest = inflight.current.get(key);
    if (!latest || latest.seq !== seq) {
      // A later edit of this cell is on its way and decides what shows.
      if (latest && saved !== undefined) latest.before = saved;
      return;
    }
    inflight.current.delete(key);
    if (saved === undefined) {
      // Only this cell goes back: the row's other cells may have saves of their own.
      setCell(recordId, fieldId, (latest.before ?? null) as StoredValue | null);
    } else if (JSON.stringify(saved) !== JSON.stringify(value)) {
      // The server tidied it (a trimmed space, a rounded cent): show what's stored.
      setCell(recordId, fieldId, saved);
    }
  }

  async function addChoice(fieldId: string, label: string): Promise<Choice | null> {
    // Added on the server to the field's current choices, so one someone
    // else added meanwhile stays.
    const added = await track(addChoiceAction(orgId, fieldId, label));
    if (!added) return null;
    setFields((fs) => fs.map((f) => (f.id === fieldId ? added.field : f)));
    return added.choice;
  }

  /** Replaces the list with the first rows matching `q` (`limit` keeps as many as were loaded). */
  async function loadList(q: string, limit?: number) {
    const seq = ++listSeq.current;
    setLoading("search");
    const result = await loadRecordsAction(orgId, database.id, { trash, q, limit });
    if (seq !== listSeq.current) return;
    setLoading(null);
    if (!result.data) {
      toast({ title: "Couldn't load the rows", description: result.error });
      return;
    }
    setRecords(result.data.records);
    setNext(result.data.next);
    setTotal(result.data.total);
    setSearchedFor(q);
    setSelected(new Set());
  }

  function reloadLoaded() {
    return loadList(searchedFor, records.length > 0 ? records.length : undefined);
  }

  function search(text: string) {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = text.trim();
    if (q === searchedFor) {
      // Back to what's shown: drop any search still on its way.
      listSeq.current++;
      setLoading(null);
      return;
    }
    searchTimer.current = setTimeout(() => void loadList(q), SEARCH_AFTER_MS);
  }

  async function loadMore() {
    if (!next || loading) return;
    const seq = listSeq.current;
    setLoading("more");
    const result = await loadRecordsAction(orgId, database.id, {
      trash,
      q: searchedFor,
      after: next,
    });
    if (seq !== listSeq.current) return;
    setLoading(null);
    if (!result.data) {
      toast({ title: "Couldn't load more rows", description: result.error });
      return;
    }
    const page = result.data;
    setRecords((rs) => mergeRows(rs, page.records, trash));
    setNext(page.next);
    setTotal(page.total);
  }

  async function addRow() {
    const row = await track(createRecordAction(orgId, database.id, {}));
    if (!row) return;
    setRecords((rs) => [...rs, row]);
    setTotal((n) => n + 1);
    setSort(null);
    requestAnimationFrame(() => {
      const cell = tableRef.current?.querySelector<HTMLElement>(
        `[data-row="${row.id}"] [data-primary] [data-cell-input]`,
      );
      cell?.focus();
      cell?.scrollIntoView({ block: "nearest" });
    });
  }

  async function changeType(field: FieldDef, type: FieldType) {
    if (type === field.type) return;
    const hasData = next !== null || records.some((r) => r.values[field.id] !== undefined);
    if (hasData) {
      const ok = await confirm({
        title: `Change “${field.name}” to ${FIELD_TYPE_META[type].label.toLowerCase()}?`,
        description: hasChoices(type)
          ? "Each different value becomes a choice (up to 100, each up to 80 characters); values that don't get one are cleared. This can't be undone."
          : "Values that fit the new type are kept and converted; the rest are cleared. This can't be undone.",
        confirmLabel: "Change type",
      });
      if (!ok) return;
    }
    const updated = await track(updateFieldAction(orgId, field.id, { type }));
    if (!updated) return;
    setFields((fs) => fs.map((f) => (f.id === field.id ? updated.field : f)));
    if (updated.cleared > 0) {
      toast({
        title:
          updated.cleared === 1
            ? "1 value didn't fit and was cleared"
            : `${formatCount(updated.cleared)} values didn't fit and were cleared`,
        description: hasChoices(type)
          ? "A select field holds up to 100 choices, each up to 80 characters."
          : `They couldn't be read as ${FIELD_TYPE_META[type].label.toLowerCase()}.`,
      });
    }
    // The values were converted on the server: show them as they are now.
    await reloadLoaded();
  }

  async function saveChoices(field: FieldDef, choices: Choice[]): Promise<boolean> {
    const updated = await track(
      updateFieldAction(orgId, field.id, {
        options: { ...field.options, choices },
        // Refused if someone else changed the choices since this list was loaded.
        choicesVersion: choicesVersion(field.options.choices),
      }),
    );
    if (!updated) return false;
    setFields((fs) => fs.map((f) => (f.id === updated.field.id ? updated.field : f)));
    const removed = (field.options.choices ?? []).some((c) => !choices.some((n) => n.id === c.id));
    // A removed choice was taken out of every row that had it.
    if (removed) await reloadLoaded();
    return true;
  }

  async function removeField(field: FieldDef) {
    const ok = await confirm({
      title: `Delete the “${field.name}” field?`,
      description: "Its values in every row are deleted too. This can't be undone.",
      confirmLabel: "Delete field",
      run: async () => (await deleteFieldAction(orgId, field.id)).error,
    });
    if (!ok) return;
    setFields((fs) => fs.filter((f) => f.id !== field.id));
    setRecords((rs) => rs.map((r) => ({ ...r, values: withValue(r.values, field.id, null) })));
  }

  async function move(field: FieldDef, direction: -1 | 1) {
    const i = fields.findIndex((f) => f.id === field.id);
    const j = i + direction;
    if (j < 1 || j >= fields.length) return;
    const order = [...fields];
    [order[i], order[j]] = [order[j]!, order[i]!];
    setFields(order);
    await track(moveFieldAction(orgId, field.id, direction));
  }

  async function trashRows(ids: string[]) {
    if (ids.length === 0) return;
    const done = await track(trashRecordsAction(orgId, database.id, ids));
    if (done === undefined) return;
    const gone = new Set(ids);
    const removed = records.filter((r) => gone.has(r.id));
    setRecords((rs) => rs.filter((r) => !gone.has(r.id)));
    setTotal((n) => Math.max(0, n - done));
    setTrashCount((n) => n + done);
    setSelected(new Set());
    toast({
      title: ids.length === 1 ? "Row deleted" : `${formatCount(ids.length)} rows deleted`,
      action: {
        label: "Undo",
        run: async () => {
          const result = await restoreRecordsAction(orgId, database.id, ids);
          if (result.data !== undefined) {
            const back = result.data;
            setRecords((rs) => mergeRows(rs, removed, false));
            setTotal((n) => n + back);
            setTrashCount((n) => Math.max(0, n - back));
          }
          return result.error;
        },
      },
    });
  }

  async function restore(ids: string[]) {
    const done = await track(restoreRecordsAction(orgId, database.id, ids));
    if (done === undefined) return;
    const gone = new Set(ids);
    setRecords((rs) => rs.filter((r) => !gone.has(r.id)));
    setTotal((n) => Math.max(0, n - done));
    setTrashCount((n) => Math.max(0, n - done));
    toast({
      title: ids.length === 1 ? "Row restored" : `${formatCount(ids.length)} rows restored`,
    });
  }

  async function purge(ids: string[] | "all") {
    let purged = 0;
    const ok = await confirm({
      title: ids === "all" ? "Delete all for good?" : "Delete for good?",
      description: "These rows are deleted forever. This can't be undone.",
      confirmLabel: "Delete forever",
      run: async () => {
        const result = await purgeRecordsAction(orgId, database.id, ids);
        purged = result.data ?? 0;
        return result.error;
      },
    });
    if (!ok) return;
    if (ids === "all") {
      setRecords([]);
      setNext(null);
      setTotal(0);
      setTrashCount(0);
      return;
    }
    const gone = new Set(ids);
    setRecords((rs) => rs.filter((r) => !gone.has(r.id)));
    setTotal((n) => Math.max(0, n - purged));
    setTrashCount((n) => Math.max(0, n - purged));
  }

  async function exportCsv() {
    // Every matching row, not just the loaded pages.
    let rows = records;
    let cursor = next;
    if (cursor) {
      setExporting(true);
      try {
        while (cursor) {
          const result = await loadRecordsAction(orgId, database.id, {
            trash,
            q: searchedFor,
            after: cursor,
            limit: EXPORT_PAGE,
          });
          if (!result.data) {
            toast({ title: "The export didn't finish", description: result.error });
            return;
          }
          rows = mergeRows(rows, result.data.records, trash);
          cursor = result.data.next;
        }
      } finally {
        setExporting(false);
      }
    }
    const header = fields.map((f) => f.name);
    const lines = sortRows(rows, fields, sort, memberNames).map((r) =>
      fields.map((f) => displayText(f, r.values[f.id], memberNames)),
    );
    const csv = [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${database.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Rows get these through stable wrappers that call the latest render's
  // functions, so a save re-renders the row it changed and not every row.
  const latest =
    useRef<Pick<RowActions, "save" | "addChoice" | "trash" | "restore" | "purge">>(null);
  useEffect(() => {
    latest.current = {
      save: (recordId, fieldId, value) => void saveCell(recordId, fieldId, value),
      addChoice,
      trash: (recordId) => void trashRows([recordId]),
      restore: (recordId) => void restore([recordId]),
      purge: (recordId) => void purge([recordId]),
    };
  });
  const actions = useMemo<RowActions>(
    () => ({
      save: (recordId, fieldId, value) => latest.current?.save(recordId, fieldId, value),
      addChoice: async (fieldId, label) =>
        (await latest.current?.addChoice(fieldId, label)) ?? null,
      select: (recordId, on) =>
        setSelected((sel) => {
          const picked = new Set(sel);
          if (on) picked.add(recordId);
          else picked.delete(recordId);
          return picked;
        }),
      expand: (recordId) => setExpanded(recordId),
      trash: (recordId) => latest.current?.trash(recordId),
      restore: (recordId) => latest.current?.restore(recordId),
      purge: (recordId) => latest.current?.purge(recordId),
    }),
    [],
  );

  const status =
    pending > 0 ? (
      <span
        className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
        role="status"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    ) : failed ? (
      <span className="text-destructive inline-flex items-center gap-1.5 text-xs" role="status">
        <CircleAlert className="size-3.5" aria-hidden="true" />
        Last change not saved
      </span>
    ) : (
      <span
        className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
        role="status"
      >
        <Check className="size-3.5" aria-hidden="true" />
        All changes saved
      </span>
    );

  const noun = (n: number) =>
    searchedFor ? (n === 1 ? "match" : "matches") : n === 1 ? "row" : "rows";
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const expandedRecord = records.find((r) => r.id === expanded) ?? null;

  // The live summary under the title: how big the database is.
  const summary = [
    `${formatCount(total)} ${total === 1 ? "row" : "rows"}`,
    `${fields.length} ${fields.length === 1 ? "field" : "fields"}`,
  ].join(" · ");

  return (
    <div className="space-y-7.5">
      {confirmEl}
      <div className="space-y-3">
        <BackLink
          href={trash ? base : `/app/${orgSlug}/databases`}
          label={trash ? database.name : "Databases"}
        />
        <PageHeader
          title={trash ? "Recently deleted" : database.name}
          description={
            trash
              ? "Deleted rows. Restore them, or delete them for good."
              : database.description
                ? `${summary} · ${database.description}`
                : summary
          }
          actions={
            <>
              {!trash && status}
              {!trash && canEdit && (
                <Button variant="create" onClick={() => void addRow()}>
                  <Plus aria-hidden="true" />
                  New row
                </Button>
              )}
              {trash && database.canManage && records.length > 0 && (
                <Button variant="destructive" onClick={() => void purge("all")}>
                  <Trash2 aria-hidden="true" />
                  Delete all for good
                </Button>
              )}
              {!trash && (
                <ItemMenu
                  label={`More actions for ${database.name}`}
                  className="border-input"
                  items={[
                    {
                      label: exporting ? "Exporting…" : "Export CSV",
                      icon: Download,
                      onSelect: () => void exportCsv(),
                    },
                    {
                      label: `Recently deleted${trashCount ? ` (${formatCount(trashCount)})` : ""}`,
                      icon: Trash2,
                      href: `${base}?trash=1`,
                    },
                    database.canManage && {
                      label: "Settings",
                      icon: Settings2,
                      onSelect: () => setSettingsOpen(true),
                      separated: true,
                    },
                  ]}
                />
              )}
            </>
          }
        />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SearchField
            value={query}
            onValueChange={search}
            placeholder={`Search ${database.name}`}
            aria-label={`Search ${database.name}`}
          />
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[13px] tabular-nums">
            {loading === "search" && (
              <Loader2 className="size-3.5 animate-spin" aria-label="Searching" />
            )}
            {next === null
              ? `${formatCount(records.length)} ${noun(records.length)}`
              : `${formatCount(records.length)} of ${formatCount(total)} ${noun(total)} loaded`}
          </span>
          {sort && next !== null && (
            <span className="text-muted-foreground text-[13px]">
              · Sorting the loaded rows; load the rest to sort them all.
            </span>
          )}
          {!database.canEdit && !trash && (
            <span className="text-muted-foreground text-[13px]">
              · You can view this database; its owners and admins edit it.
            </span>
          )}
          {selected.size > 0 && canEdit && (
            <span className="bg-muted ms-auto flex h-10 items-center gap-3 rounded-full ps-4 pe-1">
              <span className="text-sm font-semibold tabular-nums">
                {formatCount(selected.size)} selected
              </span>
              <Button size="sm" variant="destructive" onClick={() => void trashRows([...selected])}>
                <Trash2 aria-hidden="true" />
                {selected.size === 1 ? "Delete row" : `Delete ${formatCount(selected.size)} rows`}
              </Button>
            </span>
          )}
        </div>

        <TableFrame
          className={cn(
            // The first column sticks while the grid scrolls sideways: above
            // the other header cells, and body cells pass under it.
            "[&_thead_th[data-primary]]:z-20",
          )}
        >
          <Table ref={tableRef} className="w-max min-w-full">
            <TableHeader>
              <TableRow>
                {fields.map((f, i) => (
                  <TableHead
                    key={f.id}
                    scope="col"
                    data-primary={f.isPrimary || undefined}
                    style={{
                      width: WIDTH[f.type] + (f.isPrimary && canEdit ? 36 : 0),
                      minWidth: WIDTH[f.type] + (f.isPrimary && canEdit ? 36 : 0),
                    }}
                    className={cn("px-1", f.isPrimary && "left-0")}
                  >
                    {f.isPrimary && canEdit ? (
                      <div className="flex items-center">
                        <span className="grid w-9 shrink-0 place-items-center">
                          <Checkbox
                            aria-label="Select all rows"
                            checked={allShownSelected}
                            onCheckedChange={(v) =>
                              setSelected(v === true ? new Set(shown.map((r) => r.id)) : new Set())
                            }
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <FieldHeader
                            field={f}
                            index={i}
                            count={fields.length}
                            sort={sort}
                            canManage={database.canManage && !trash}
                            onSort={(dir) => setSort(dir ? { fieldId: f.id, dir } : null)}
                            onRename={() => setRenaming(f)}
                            onChoices={() => setEditingChoices(f)}
                            onType={(t) => void changeType(f, t)}
                            onMove={(d) => void move(f, d)}
                            onDelete={() => void removeField(f)}
                          />
                        </div>
                      </div>
                    ) : (
                      <FieldHeader
                        field={f}
                        index={i}
                        count={fields.length}
                        sort={sort}
                        canManage={database.canManage && !trash}
                        onSort={(dir) => setSort(dir ? { fieldId: f.id, dir } : null)}
                        onRename={() => setRenaming(f)}
                        onChoices={() => setEditingChoices(f)}
                        onType={(t) => void changeType(f, t)}
                        onMove={(d) => void move(f, d)}
                        onDelete={() => void removeField(f)}
                      />
                    )}
                  </TableHead>
                ))}
                {database.canManage && !trash && (
                  <TableHead className="w-12 px-1">
                    <NewFieldPopover
                      onAdd={async (name, type) => {
                        const field = await track(
                          addFieldAction(orgId, database.id, {
                            name,
                            type,
                            options: hasChoices(type) ? { choices: [] } : {},
                          }),
                        );
                        if (field) setFields((fs) => [...fs, field]);
                        return Boolean(field);
                      }}
                    />
                  </TableHead>
                )}
                {trash && <TableHead className="w-48">Deleted</TableHead>}
                <TableHead className="w-12" aria-label="Row actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <GridRow
                  key={r.id}
                  record={r}
                  fields={fields}
                  primary={primary!}
                  members={members}
                  memberNames={memberNames}
                  canEdit={canEdit}
                  canManage={database.canManage}
                  canRestore={database.canEdit}
                  trash={trash}
                  selected={selected.has(r.id)}
                  formatDeleted={formatDeleted}
                  actions={actions}
                />
              ))}
            </TableBody>
          </Table>
          {records.length === 0 ? (
            searchedFor ? (
              <EmptyState
                icon={SearchX}
                title={`No rows match “${searchedFor}”`}
                description="Try another word, or clear the search."
              />
            ) : (
              <EmptyState
                icon={trash ? Trash2 : Database}
                title={trash ? "Nothing here" : "No rows yet"}
                description={
                  trash
                    ? "Rows you delete show up here."
                    : canEdit
                      ? "Add the first row. Everything you type is saved automatically."
                      : "Nothing has been added yet."
                }
                action={
                  canEdit ? (
                    <Button variant="outline" onClick={() => void addRow()}>
                      <Plus aria-hidden="true" />
                      New row
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : null}
          {next !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 pt-3 pb-1">
              <span className="text-muted-foreground text-[13px] tabular-nums">
                Showing {formatCount(records.length)} of {formatCount(total)} {noun(total)}.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={loading !== null}
                onClick={() => void loadMore()}
              >
                {loading === "more" && <Loader2 className="animate-spin" aria-hidden="true" />}
                Load more
              </Button>
            </div>
          )}
          {canEdit && records.length > 0 && (
            <button
              type="button"
              onClick={() => void addRow()}
              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground rounded-field focus-visible:outline-foreground mt-1 flex h-10 w-full items-center gap-2 px-3.5 text-sm font-medium transition-colors outline-none focus-visible:outline-2"
            >
              <Plus className="size-4" aria-hidden="true" />
              New row
            </button>
          )}
        </TableFrame>
      </div>

      <Sheet open={expandedRecord !== null} onOpenChange={(o) => !o && setExpanded(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {expandedRecord && (
            <>
              <SheetHeader className="gap-1 px-6 pt-6 pr-14 pb-5">
                <SheetTitle className="text-[19px]">
                  {displayText(primary!, expandedRecord.values[primary!.id], memberNames) ||
                    "Untitled row"}
                </SheetTitle>
                <SheetDescription>
                  {expandedRecord.updatedByName
                    ? `Last edited by ${expandedRecord.updatedByName}`
                    : "Every change saves as you make it."}
                </SheetDescription>
              </SheetHeader>
              <dl className="space-y-4 px-6 pb-8">
                {fields.map((f) => (
                  <div key={f.id} className="space-y-1.5">
                    <dt className="text-muted-foreground flex items-center gap-1.5 text-[13px] font-medium">
                      <FieldIcon type={f.type} />
                      {f.name}
                    </dt>
                    <dd className="border-input rounded-field border">
                      <CellEditor
                        field={f}
                        value={expandedRecord.values[f.id]}
                        members={members}
                        canEdit={canEdit}
                        canManage={database.canManage}
                        label={f.name}
                        onSave={(v) => actions.save(expandedRecord.id, f.id, v)}
                        onAddChoice={(label) => actions.addChoice(f.id, label)}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>

      {renaming && (
        <FieldNameDialog
          field={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const updated = await track(updateFieldAction(orgId, renaming.id, { name }));
            if (updated) {
              setFields((fs) => fs.map((f) => (f.id === updated.field.id ? updated.field : f)));
            }
            return Boolean(updated);
          }}
        />
      )}
      {editingChoices && (
        <ChoicesDialog
          field={editingChoices}
          onClose={() => setEditingChoices(null)}
          onSave={(choices) => saveChoices(editingChoices, choices)}
        />
      )}
      {database.canManage && (
        <DatabaseSettingsDialog
          orgId={orgId}
          orgSlug={orgSlug}
          database={database}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          personal={personal}
        />
      )}
    </div>
  );
}

/**
 * One row. Memoized: its props only change when its own record does (or
 * the fields, or its selection), so saving a cell doesn't re-render the
 * rest of the grid.
 */
const GridRow = memo(function GridRow({
  record: r,
  fields,
  primary,
  members,
  memberNames,
  canEdit,
  canManage,
  canRestore,
  trash,
  selected,
  formatDeleted,
  actions,
}: {
  record: CustomRecord;
  fields: FieldDef[];
  primary: FieldDef;
  members: Member[];
  memberNames: ReadonlyMap<string, string>;
  canEdit: boolean;
  canManage: boolean;
  /** Restore from the trash (whoever edits the database). */
  canRestore: boolean;
  trash: boolean;
  selected: boolean;
  formatDeleted: (iso: string) => string;
  actions: RowActions;
}) {
  const name = displayText(primary, r.values[primary.id], memberNames);
  return (
    <TableRow data-row={r.id} data-state={selected ? "selected" : undefined} className="group/row">
      {fields.map((f) => {
        const cell = (
          <CellEditor
            field={f}
            value={r.values[f.id]}
            members={members}
            canEdit={canEdit}
            canManage={canManage}
            label={`${f.name} for ${name || "this row"}`}
            onSave={(v) => actions.save(r.id, f.id, v)}
            onAddChoice={(label) => actions.addChoice(f.id, label)}
          />
        );
        return (
          <TableCell
            key={f.id}
            data-primary={f.isPrimary || undefined}
            className={cn(
              "p-1",
              // The sticky first column needs an opaque fill, matching the row's.
              f.isPrimary &&
                "bg-card sticky left-0 z-[5] font-medium group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-data-[state=selected]/row:bg-[color-mix(in_oklab,var(--glow)_16%,var(--card))]",
            )}
          >
            {f.isPrimary && canEdit ? (
              <div className="flex items-center">
                <span className="grid w-9 shrink-0 place-items-center">
                  <Checkbox
                    aria-label={`Select ${name || "row"}`}
                    checked={selected}
                    onCheckedChange={(v) => actions.select(r.id, v === true)}
                  />
                </span>
                <div className="min-w-0 flex-1">{cell}</div>
              </div>
            ) : (
              cell
            )}
          </TableCell>
        );
      })}
      {canManage && !trash && <TableCell className="p-1" />}
      {trash && (
        <TableCell className="text-muted-foreground text-[13px] tabular-nums">
          {r.deletedAt ? formatDeleted(r.deletedAt) : ""}
        </TableCell>
      )}
      <TableCell className="px-1 py-1">
        {trash ? (
          <ItemMenu
            label="Row actions"
            className={ROW_MENU}
            items={[
              canRestore && {
                label: "Restore",
                icon: RotateCcw,
                onSelect: () => actions.restore(r.id),
              },
              canManage && {
                label: "Delete forever",
                icon: Trash2,
                destructive: true,
                separated: true,
                onSelect: () => actions.purge(r.id),
              },
            ]}
          />
        ) : (
          <ItemMenu
            label="Row actions"
            className={ROW_MENU}
            items={[
              { label: "Expand row", icon: Maximize2, onSelect: () => actions.expand(r.id) },
              canEdit && {
                label: "Delete row",
                icon: Trash2,
                destructive: true,
                separated: true,
                onSelect: () => actions.trash(r.id),
              },
            ]}
          />
        )}
      </TableCell>
    </TableRow>
  );
});

function FieldHeader({
  field,
  index,
  count,
  sort,
  canManage,
  onSort,
  onRename,
  onChoices,
  onType,
  onMove,
  onDelete,
}: {
  field: FieldDef;
  index: number;
  count: number;
  sort: Sort;
  canManage: boolean;
  onSort: (dir: 1 | -1 | null) => void;
  onRename: () => void;
  onChoices: () => void;
  onType: (type: FieldType) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const sorted = sort?.fieldId === field.id ? sort.dir : null;
  // Numbers and money sit right-aligned, their header too.
  const numeric = field.type === "NUMBER" || field.type === "CURRENCY";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "hover:text-foreground hover:bg-muted-strong/60 data-[state=open]:bg-muted-strong/60 data-[state=open]:text-foreground rounded-field focus-visible:outline-foreground flex h-8 w-full items-center gap-1.5 px-2.5 text-left text-[12.5px] font-semibold transition-colors outline-none focus-visible:outline-2",
            numeric && "flex-row-reverse text-right",
            sorted && "text-foreground",
          )}
          aria-label={`${field.name} (${FIELD_TYPE_META[field.type].label}) options`}
        >
          <FieldIcon type={field.type} />
          <span className="truncate">{field.name}</span>
          {sorted &&
            (sorted === 1 ? (
              <ArrowDownAZ className="ms-auto size-3.5" aria-hidden="true" />
            ) : (
              <ArrowUpAZ className="ms-auto size-3.5" aria-hidden="true" />
            ))}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => onSort(sorted === 1 ? null : 1)}>
          <ArrowDownAZ aria-hidden="true" />
          {sorted === 1 ? "Clear sort" : "Sort A → Z"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSort(sorted === -1 ? null : -1)}>
          <ArrowUpAZ aria-hidden="true" />
          {sorted === -1 ? "Clear sort" : "Sort Z → A"}
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRename}>
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            {hasChoices(field.type) && (
              <DropdownMenuItem onSelect={onChoices}>
                <Shapes aria-hidden="true" />
                Edit choices
              </DropdownMenuItem>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FieldIcon type={field.type} />
                Change type
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {FIELD_TYPES.map((t) => (
                  <DropdownMenuItem
                    key={t}
                    onSelect={() => onType(t)}
                    disabled={
                      field.isPrimary && !["TEXT", "NUMBER", "EMAIL", "PHONE", "URL"].includes(t)
                    }
                  >
                    <FieldIcon type={t} />
                    {FIELD_TYPE_META[t].label}
                    {t === field.type && <Check className="ms-auto" aria-hidden="true" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {!field.isPrimary && (
              <>
                <DropdownMenuItem onSelect={() => onMove(-1)} disabled={index <= 1}>
                  <ArrowLeft aria-hidden="true" />
                  Move left
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(1)} disabled={index >= count - 1}>
                  <ArrowRight aria-hidden="true" />
                  Move right
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 aria-hidden="true" />
                  Delete field
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
