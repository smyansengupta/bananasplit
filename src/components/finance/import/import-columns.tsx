"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Info, Loader2 } from "lucide-react";
import { useState } from "react";

import { ConnectionPicker, type useAiConnections } from "@/components/ai/connection-picker";
import { Button } from "@/components/ui/button";
import type { AiLabel, SheetRead } from "@/lib/ai/finance-sheet";
import {
  AMOUNT_SIGN_LABEL,
  AMOUNT_SIGNS,
  COLUMN_ROLES,
  ROLE_LABEL,
  guessMapping,
  setColumnRole,
  type AmountSign,
  type ColumnRole,
  type SheetMapping,
  type ValueLabel,
} from "@/lib/finance/import/mapping";
import { buildSheetSample } from "@/lib/finance/import/sample";
import type { SheetData } from "@/lib/finance/import/sheet";
import type { DateOrder } from "@/lib/finance/import/values";
import { cn } from "@/lib/utils";

/**
 * Which column is which. The guess is shown on a preview of the sheet with
 * a picker over every column; "Read it with …" asks the club's AI model to
 * map it instead (and to sort the rows into categories), from a sample.
 */

const PREVIEW_ROWS = 8;

const selectClass = "border-input bg-background h-8 w-full min-w-28 rounded-md border px-2 text-xs";

const TRANSACTION_ROLES = COLUMN_ROLES.filter((r) => r !== "allocated");
const BUDGET_ROLES: readonly ColumnRole[] = ["category", "description", "allocated", "amount", "notes", "ignore"];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$#]+/g, " ")
    .trim();

export function ImportColumns({
  orgId,
  orgSlug,
  today,
  fileName,
  sheets,
  sheetIndex,
  mapping,
  labels,
  ai,
  readBy,
  notes,
  onRead,
  onChange,
  onBack,
  onContinue,
}: {
  orgId: string;
  orgSlug: string;
  today: string;
  fileName: string;
  sheets: SheetData[];
  sheetIndex: number;
  mapping: SheetMapping;
  labels: Map<string, ValueLabel>;
  ai: ReturnType<typeof useAiConnections>;
  readBy: string | null;
  notes: string[];
  onRead: (mapping: SheetMapping | null, labels: AiLabel[], readBy: string, notes: string[]) => void;
  onChange: (next: { sheetIndex?: number; mapping?: SheetMapping; labels?: Map<string, ValueLabel> }) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = sheets[sheetIndex];
  const width = Math.min(60, sheet.rows.reduce((w, r) => Math.max(w, r.length), 0));
  const columns = Array.from({ length: width }, (_, c) => c);
  const header = mapping.headerRow >= 0 ? sheet.rows[mapping.headerRow] : null;
  const preview = sheet.rows.slice(mapping.headerRow + 1, mapping.headerRow + 1 + PREVIEW_ROWS);
  const dataRows = sheet.rows.length - (mapping.headerRow + 1);
  const has = (role: ColumnRole) => mapping.roles.includes(role);
  const money = has("amount") || has("moneyIn") || has("moneyOut") || (mapping.kind === "budget" && has("allocated"));
  const typeCol = mapping.roles.indexOf("type");
  const typeValues =
    typeCol >= 0
      ? [...new Set(sheet.rows.slice(mapping.headerRow + 1).map((r) => norm(r[typeCol] ?? "")).filter(Boolean))].slice(0, 24)
      : [];
  const roles = mapping.kind === "budget" ? BUDGET_ROLES : TRANSACTION_ROLES;
  const set = (patch: Partial<SheetMapping>) => onChange({ mapping: { ...mapping, ...patch } });

  async function readWithAi() {
    if (!ai.selected) return;
    setReading(true);
    setError(null);
    try {
      const sample = buildSheetSample(sheet, mapping, fileName, today);
      const res = await fetch(`/api/orgs/${orgId}/ai/finance-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "sheet", sample, connection: ai.selected.id }),
      });
      const json = (await res.json().catch(() => null)) as (SheetRead & { readBy?: string; error?: string }) | null;
      if (!res.ok || !json) throw new Error(json?.error ?? "The sheet couldn't be read. Try again.");
      onRead(
        json.mapping,
        json.labels ?? [],
        json.readBy ?? ai.selected.label,
        json.mapping
          ? json.notes
          : [...json.notes, "The model couldn't find money records in this sheet, so the columns were left as they were."],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sheet couldn't be read. Try again.");
    } finally {
      setReading(false);
    }
  }

  function pickSheet(i: number) {
    onChange({ sheetIndex: i, mapping: guessMapping(sheets[i], today), labels: new Map() });
  }

  function setTypeValue(value: string, way: "in" | "out" | "none") {
    const typeIn = mapping.typeIn.filter((v) => norm(v) !== value);
    const typeOut = mapping.typeOut.filter((v) => norm(v) !== value);
    if (way === "in") typeIn.push(value);
    if (way === "out") typeOut.push(value);
    set({ typeIn, typeOut });
  }

  const categorized = labels.size;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Which column is which?</h2>
          <p className="text-muted-foreground text-sm">
            {fileName} · {dataRows.toLocaleString()} row{dataRows === 1 ? "" : "s"}
            {sheet.truncated ? " (only the first 20,000 are read)" : ""}. Check the guess, or let AI read it.
          </p>
        </div>
        {sheets.length > 1 && (
          <div className="bg-muted inline-flex max-w-full flex-wrap gap-1 rounded-lg p-1" role="tablist" aria-label="Sheets">
            {sheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                role="tab"
                aria-selected={i === sheetIndex}
                onClick={() => pickSheet(i)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  i === sheetIndex ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.name}
                {s.hidden ? " (hidden)" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="bg-primary/5 border-primary/20 space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ConnectionPicker
            orgSlug={orgSlug}
            list={ai.list}
            failed={ai.failed}
            selected={ai.selected}
            onChoose={ai.setChoice}
            what="the first rows and each text column's values"
          />
          {ai.selected && (
            <Button type="button" onClick={() => void readWithAi()} disabled={reading}>
              {reading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {reading ? "Reading…" : readBy ? "Read it again" : `Read it with ${ai.selected.label}`}
            </Button>
          )}
        </div>
        {readBy && (
          <p className="text-success flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Read by {readBy}
            {categorized > 0 ? ` · ${categorized} value${categorized === 1 ? "" : "s"} sorted into categories` : ""}
          </p>
        )}
        {notes.length > 0 && (
          <ul className="text-muted-foreground space-y-1 text-xs">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {n}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground font-medium">What&apos;s in it</span>
          <select
            className={selectClass}
            value={mapping.kind}
            onChange={(e) => set({ kind: e.target.value as SheetMapping["kind"] })}
          >
            <option value="transactions">Money in and out (a ledger or statement)</option>
            <option value="budget">A budget (an amount per category)</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground font-medium">Column names are in</span>
          <select
            className={selectClass}
            value={mapping.headerRow}
            onChange={(e) => set({ headerRow: Number(e.target.value) })}
          >
            <option value={-1}>No header row</option>
            {sheet.rows.slice(0, 15).map((r, i) => (
              <option key={i} value={i}>
                Row {i + 1}: {r.filter(Boolean).slice(0, 3).join(", ").slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        {mapping.kind === "transactions" && has("amount") && !has("moneyIn") && !has("moneyOut") && (
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground font-medium">Money in or out</span>
            <select
              className={selectClass}
              value={mapping.amountSign}
              onChange={(e) => set({ amountSign: e.target.value as AmountSign })}
            >
              {AMOUNT_SIGNS.filter((s) => s !== "by-type" || typeCol >= 0).map((s) => (
                <option key={s} value={s}>
                  {AMOUNT_SIGN_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        {mapping.kind === "transactions" && has("date") && (
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground font-medium">Dates are written</span>
            <select
              className={selectClass}
              value={mapping.dateOrder}
              onChange={(e) => set({ dateOrder: e.target.value as DateOrder })}
            >
              <option value="MDY">Month first (9/5/2026 is Sep 5)</option>
              <option value="DMY">Day first (5/9/2026 is Sep 5)</option>
              <option value="YMD">Year first (2026-09-05)</option>
            </select>
          </label>
        )}
      </div>

      {mapping.kind === "transactions" && mapping.amountSign === "by-type" && typeValues.length > 0 && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">What does each type mean?</p>
          <ul className="flex flex-wrap gap-2">
            {typeValues.map((v) => {
              const way = mapping.typeIn.map(norm).includes(v) ? "in" : mapping.typeOut.map(norm).includes(v) ? "out" : "none";
              return (
                <li key={v} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  <span className="font-medium">{v}</span>
                  <select
                    aria-label={`${v} means`}
                    className="border-input bg-background h-7 rounded border px-1 text-xs"
                    value={way}
                    onChange={(e) => setTypeValue(v, e.target.value as "in" | "out" | "none")}
                  >
                    <option value="in">Money in</option>
                    <option value="out">Money out</option>
                    <option value="none">Not sure</option>
                  </select>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-max text-xs">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c) => (
                <th key={c} className="p-2 text-left align-top font-normal">
                  <select
                    aria-label={`Column ${c + 1}${header?.[c] ? ` (${header[c]})` : ""}`}
                    className={cn(selectClass, mapping.roles[c] !== "ignore" && "border-primary/50 bg-primary/5")}
                    value={mapping.roles[c] ?? "ignore"}
                    onChange={(e) => onChange({ mapping: setColumnRole(mapping, c, e.target.value as ColumnRole) })}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground mt-1 block max-w-48 truncate font-medium">
                    {header?.[c] || `Column ${c + 1}`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((r, i) => (
              <tr key={i} className="border-t">
                {columns.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      "max-w-56 truncate p-2",
                      mapping.roles[c] === "ignore" ? "text-muted-foreground/70" : "",
                    )}
                    title={r[c] ?? ""}
                  >
                    {r[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!money && (
        <p className="text-muted-foreground text-sm">
          Pick the column with the amounts (or the money in and money out columns) to go on.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Choose another file
        </Button>
        <Button type="button" onClick={onContinue} disabled={!money || dataRows <= 0}>
          Review {mapping.kind === "budget" ? "the budget" : `${dataRows.toLocaleString()} row${dataRows === 1 ? "" : "s"}`}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
