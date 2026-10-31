"use client";

import { LinkedLoader } from "@/components/links/linked-loader";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUpAZ,
  ChevronDown,
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
import Link from "next/link";
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
  updateDatabaseSettingsAction,
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
  parseCell,
  type Choice,
  type FieldDef,
  type FieldType,
  type StoredValue,
} from "@/lib/databases/fields";
import { cn } from "@/lib/utils";
import type { CustomDatabase, CustomRecord } from "@/server/databases/custom";

import { TableFrame } from "../table-frame";
import { CellEditor, type Member } from "./cell-editor";
import { ChoicesDialog, NewFieldPopover } from "./field-dialogs";
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
  /** Enter in a cell: the same field one row down, or a new row from the last. */
  down: (recordId: string, fieldIndex: number) => void;
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
  // ?row= (a link to one row, as the Linked panel makes) opens it.
  const [expanded, setExpanded] = useState<string | null>(() =>
    new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("row"),
  );
  const [renaming, setRenaming] = useState<FieldDef | null>(null);
  const [editingChoices, setEditingChoices] = useState<FieldDef | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dbName, setDbName] = useState(database.name);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [dragField, setDragField] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
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

  /** The text box of a row's cell (by column), if that cell has one. */
  function cellInput(recordId: string, fieldIndex: number) {
    return tableRef.current?.querySelector<HTMLElement>(
      `[data-row="${recordId}"] > td:nth-child(${fieldIndex + 1}) [data-cell-input]`,
    );
  }

  async function addRow(focusField = 0) {
    const row = await track(createRecordAction(orgId, database.id, {}));
    if (!row) return;
    setRecords((rs) => [...rs, row]);
    setTotal((n) => n + 1);
    setSort(null);
    requestAnimationFrame(() => {
      const cell = cellInput(row.id, focusField);
      cell?.focus();
      cell?.scrollIntoView({ block: "nearest" });
    });
  }

  /** Enter in a cell goes down a row, the way a spreadsheet does; from the last row it adds one. */
  function down(recordId: string, fieldIndex: number) {
    const i = shown.findIndex((r) => r.id === recordId);
    const below = shown[i + 1];
    if (below) {
      cellInput(below.id, fieldIndex)?.focus();
      return;
    }
    if (canEdit && next === null) void addRow(fieldIndex);
  }

  /**
   * Rows pasted from a spreadsheet (tab-separated lines) become new rows,
   * their columns filling the fields from the one you're in. A value that
   * doesn't fit its field is left empty rather than failing the row.
   */
  async function pasteRows(text: string, fromField: number) {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    const targets = fields.slice(fromField);
    let skipped = 0;
    let added = 0;
    for (const line of lines.slice(0, 500)) {
      const cells = line.split("\t");
      const values: Record<string, unknown> = {};
      cells.forEach((cell, k) => {
        const field = targets[k];
        if (!field || cell.trim() === "") return;
        const parsed = parseCell(field, cell.trim());
        if (parsed.ok) values[field.id] = cell.trim();
        else skipped += 1;
      });
      if (Object.keys(values).length === 0) continue;
      const row = await track(createRecordAction(orgId, database.id, values));
      if (!row) break;
      added += 1;
      setRecords((rs) => [...rs, row]);
      setTotal((n) => n + 1);
    }
    if (added > 0) {
      setSort(null);
      toast({
        title: added === 1 ? "1 row added" : `${formatCount(added)} rows added`,
        description:
          skipped > 0
            ? `${formatCount(skipped)} values didn't fit and were left empty.`
            : undefined,
        tone: "success",
      });
    }
  }

  /** Moves a field to another column, one step at a time (how the server moves them). */
  async function moveTo(fieldId: string, target: number) {
    const from = fields.findIndex((f) => f.id === fieldId);
    if (from < 1 || target < 1 || target === from || target >= fields.length) return;
    const order = [...fields];
    const [field] = order.splice(from, 1);
    order.splice(target, 0, field!);
    setFields(order);
    const step = target > from ? 1 : -1;
    for (let k = 0; k < Math.abs(target - from); k++) {
      await track(moveFieldAction(orgId, fieldId, step));
    }
  }

  async function renameField(field: FieldDef, name: string) {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === field.name) return;
    const updated = await track(updateFieldAction(orgId, field.id, { name: clean }));
    if (updated) setFields((fs) => fs.map((f) => (f.id === updated.field.id ? updated.field : f)));
  }

  /** The database's own name, edited on its title (the rest of its settings stay as they are). */
  async function renameDatabase(name: string) {
    setTitleDraft(null);
    const clean = name.trim();
    if (!clean || clean === dbName) return;
    const before = dbName;
    setDbName(clean);
    const result = await updateDatabaseSettingsAction(orgId, database.id, {
      name: clean,
      description: database.description || null,
      memberVisibility: database.memberVisibility,
      memberCanEdit: database.memberCanEdit,
    });
    if (result.error) {
      setDbName(before);
      toast({ title: "Not saved", description: result.error, tone: "error" });
    }
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
      title: ids.length === 1 ? "Deleted" : `${formatCount(ids.length)} deleted`,
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
      title: ids.length === 1 ? "Restored" : `${formatCount(ids.length)} restored`,
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
    useRef<Pick<RowActions, "save" | "down" | "addChoice" | "trash" | "restore" | "purge">>(null);
  useEffect(() => {
    latest.current = {
      save: (recordId, fieldId, value) => void saveCell(recordId, fieldId, value),
      down,
      addChoice,
      trash: (recordId) => void trashRows([recordId]),
      restore: (recordId) => void restore([recordId]),
      purge: (recordId) => void purge([recordId]),
    };
  });
  const actions = useMemo<RowActions>(
    () => ({
      save: (recordId, fieldId, value) => latest.current?.save(recordId, fieldId, value),
      down: (recordId, fieldIndex) => latest.current?.down(recordId, fieldIndex),
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
        Saved
      </span>
    );

  // More rows load as the bottom of the grid scrolls into view.
  useEffect(() => {
    const el = moreRef.current;
    if (!el || next === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && loading === null) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, loading]);

  const noun = (n: number) =>
    searchedFor ? (n === 1 ? "match" : "matches") : n === 1 ? "row" : "rows";
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const expandedRecord = records.find((r) => r.id === expanded) ?? null;

  // Managers rename the database on its title (a hidden one through Settings).
  const canRename = database.canManage && !trash && database.memberVisibility !== "HIDDEN";
  const title = trash ? (
    "Recently deleted"
  ) : titleDraft !== null ? (
    <input
      autoFocus
      value={titleDraft}
      maxLength={80}
      aria-label="Database name"
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={() => void renameDatabase(titleDraft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void renameDatabase(titleDraft);
        if (e.key === "Escape") setTitleDraft(null);
      }}
      className="border-input bg-card focus-glow w-full max-w-xl rounded-lg border px-2 outline-none"
    />
  ) : canRename ? (
    <button
      type="button"
      title="Rename"
      onClick={() => setTitleDraft(dbName)}
      className="hover:bg-muted -mx-1 rounded-md px-1 text-left"
    >
      {dbName}
    </button>
  ) : (
    dbName
  );

  return (
    <div className="space-y-7.5">
      {confirmEl}
      <div className="space-y-3">
        <BackLink
          href={trash ? base : `/app/${orgSlug}/databases`}
          label={trash ? dbName : "Databases"}
        />
        <PageHeader
          title={title}
          description={!trash && database.description ? database.description : undefined}
          actions={
            <>
              {!trash && status}
              {trash && database.canManage && records.length > 0 && (
                <Button variant="destructive" onClick={() => void purge("all")}>
                  <Trash2 aria-hidden="true" />
                  Delete all for good
                </Button>
              )}
              {!trash && (
                <>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`${base}?trash=1`}>
                      <Trash2 aria-hidden="true" />
                      Recently deleted{trashCount ? ` ${formatCount(trashCount)}` : ""}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Export CSV"
                    title="Export CSV"
                    disabled={exporting}
                    onClick={() => void exportCsv()}
                  >
                    {exporting ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Download aria-hidden="true" />
                    )}
                  </Button>
                  {database.canManage && (
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Settings"
                      title="Settings"
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings2 aria-hidden="true" />
                    </Button>
                  )}
                </>
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
            <span className="text-muted-foreground text-[13px]">Sorted loaded rows only</span>
          )}
          {!database.canEdit && !trash && (
            <span className="text-muted-foreground text-[13px]">View only</span>
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
          <Table
            ref={tableRef}
            className="w-max min-w-full"
            onPaste={(e) => {
              if (!canEdit) return;
              const text = e.clipboardData.getData("text/plain");
              // One value pastes into its cell as usual; rows (tabs or lines) become rows.
              if (!text.includes("\t") && !text.replace(/\r?\n$/, "").includes("\n")) return;
              e.preventDefault();
              const cell = (e.target as HTMLElement).closest("td");
              void pasteRows(text, cell ? cell.cellIndex : 0);
            }}
          >
            <TableHeader>
              <TableRow>
                {fields.map((f, i) => (
                  <TableHead
                    key={f.id}
                    scope="col"
                    data-primary={f.isPrimary || undefined}
                    draggable={
                      database.canManage && !trash && !f.isPrimary && renaming?.id !== f.id
                    }
                    onDragStart={(e) => {
                      setDragField(f.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("application/x-bananasplit-field", f.id);
                    }}
                    onDragEnd={() => setDragField(null)}
                    onDragOver={(e) => {
                      if (dragField && !f.isPrimary) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragField) void moveTo(dragField, i);
                      setDragField(null);
                    }}
                    style={{
                      width: WIDTH[f.type] + (f.isPrimary && canEdit ? 36 : 0),
                      minWidth: WIDTH[f.type] + (f.isPrimary && canEdit ? 36 : 0),
                    }}
                    className={cn(
                      "px-1",
                      f.isPrimary && "left-0",
                      dragField === f.id && "opacity-50",
                    )}
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
                            renaming={renaming?.id === f.id}
                            onRename={() => setRenaming(f)}
                            onRenamed={(name) => void renameField(f, name)}
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
                        renaming={renaming?.id === f.id}
                        onRename={() => setRenaming(f)}
                        onRenamed={(name) => void renameField(f, name)}
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
              <EmptyState icon={SearchX} title={`No rows match “${searchedFor}”`} />
            ) : (
              <EmptyState
                icon={trash ? Trash2 : Database}
                title={trash ? "Nothing here" : "No rows yet"}
                description={
                  canEdit && !trash ? "Paste rows from a spreadsheet, or add one." : undefined
                }
                action={
                  canEdit && !trash ? (
                    <Button variant="secondary" onClick={() => void addRow()}>
                      <Plus aria-hidden="true" />
                      New row
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : null}
          {/* One New row, at the bottom where the next row goes (Enter on
              the last row adds one too). */}
          {!trash && canEdit && next === null && records.length > 0 && (
            <button
              type="button"
              onClick={() => void addRow()}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-field flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium transition-colors"
            >
              <Plus className="size-4" aria-hidden="true" />
              New row
            </button>
          )}
          {next !== null && (
            <div ref={moreRef} className="flex justify-center px-3.5 pt-3 pb-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={loading !== null}
                onClick={() => void loadMore()}
              >
                {loading === "more" && <Loader2 className="animate-spin" aria-hidden="true" />}
                Load more
              </Button>
            </div>
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
                <SheetDescription className={cn(!expandedRecord.updatedByName && "sr-only")}>
                  {expandedRecord.updatedByName
                    ? `Last edited by ${expandedRecord.updatedByName}`
                    : "Row details"}
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
              <div className="px-6 pb-8">
                <LinkedLoader
                  orgId={orgId}
                  orgSlug={orgSlug}
                  at={{ kind: "record", id: expandedRecord.id }}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
            onEnter={() => actions.down(r.id, fields.indexOf(f))}
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
                <OpenRow onOpen={() => actions.expand(r.id)} name={name} />
              </div>
            ) : f.isPrimary ? (
              <div className="flex items-center">
                <div className="min-w-0 flex-1">{cell}</div>
                <OpenRow onOpen={() => actions.expand(r.id)} name={name} />
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
              canEdit && {
                label: "Delete row",
                icon: Trash2,
                destructive: true,
                onSelect: () => actions.trash(r.id),
              },
            ]}
          />
        )}
      </TableCell>
    </TableRow>
  );
});

/** The open-row button on a row's first cell (shown on hover, always on touch). */
function OpenRow({ onOpen, name }: { onOpen: () => void; name: string }) {
  return (
    <button
      type="button"
      aria-label={`Open ${name || "row"}`}
      title="Open"
      onClick={onOpen}
      className="text-muted-foreground hover:text-foreground hover:bg-muted focus-glow grid size-7 shrink-0 place-items-center rounded-full opacity-0 outline-none group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
    >
      <Maximize2 className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/**
 * A column's header: click the name to sort (A to Z, Z to A, then off),
 * double-click it to rename (managers), drag the header to move the column,
 * and the chevron opens the rest (choices, type, move, delete).
 */
function FieldHeader({
  field,
  index,
  count,
  sort,
  canManage,
  renaming,
  onSort,
  onRename,
  onRenamed,
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
  renaming: boolean;
  onSort: (dir: 1 | -1 | null) => void;
  onRename: () => void;
  onRenamed: (name: string) => void;
  onChoices: () => void;
  onType: (type: FieldType) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(field.name);
  const sorted = sort?.fieldId === field.id ? sort.dir : null;
  // Numbers and money sit right-aligned, their header too.
  const numeric = field.type === "NUMBER" || field.type === "CURRENCY";
  if (renaming) {
    return (
      <input
        autoFocus
        defaultValue={field.name}
        maxLength={60}
        aria-label={`Rename ${field.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRenamed(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRenamed(draft);
          if (e.key === "Escape") onRenamed(field.name);
        }}
        className="border-input bg-card focus-glow h-8 w-full rounded-lg border px-2 text-[12.5px] font-semibold outline-none"
      />
    );
  }
  return (
    <div className={cn("flex items-center", numeric && "flex-row-reverse")}>
      <button
        type="button"
        onClick={() => onSort(sorted === 1 ? -1 : sorted === -1 ? null : 1)}
        onDoubleClick={canManage ? onRename : undefined}
        title={canManage ? "Click to sort, double-click to rename" : "Click to sort"}
        aria-label={`Sort by ${field.name}${sorted === 1 ? ", sorted A to Z" : sorted === -1 ? ", sorted Z to A" : ""}`}
        className={cn(
          "hover:text-foreground hover:bg-muted-strong/60 rounded-field focus-visible:outline-foreground flex h-8 min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-[12.5px] font-semibold transition-colors outline-none focus-visible:outline-2",
          numeric && "flex-row-reverse text-right",
          sorted && "text-foreground",
        )}
      >
        <FieldIcon type={field.type} />
        <span className="min-w-0 break-words">{field.name}</span>
        {sorted &&
          (sorted === 1 ? (
            <ArrowDownAZ className="ms-auto size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ArrowUpAZ className="ms-auto size-3.5 shrink-0" aria-hidden="true" />
          ))}
      </button>
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${field.name} options`}
              className="text-muted-foreground hover:text-foreground hover:bg-muted-strong/60 data-[state=open]:bg-muted-strong/60 grid size-7 shrink-0 place-items-center rounded-full outline-none focus-visible:outline-2"
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
