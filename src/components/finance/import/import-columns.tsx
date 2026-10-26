"use client";

import { ArrowLeft, ArrowRight, Check, Info, Loader2, Sparkles } from "@/components/icons";
import { useState } from "react";

import { ConnectionPicker, type useAiConnections } from "@/components/ai/connection-picker";
import { TableFrame } from "@/components/databases/table-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

import { ErrorNotice, fieldSelect, fieldSelectSm, ImportPanel, WarningNotice } from "./panel";

/**
 * Which column is which. The guess is shown on a preview of the sheet with
 * a picker over every column; "Read it with …" asks the club's AI model to
 * map it instead (and to sort the rows into categories), from a sample.
 */

const PREVIEW_ROWS = 8;

const TRANSACTION_ROLES = COLUMN_ROLES.filter((r) => r !== "allocated");
const BUDGET_ROLES: readonly ColumnRole[] = [
  "category",
  "description",
  "allocated",
  "amount",
  "notes",
  "ignore",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$#]+/g, " ")
    .trim();

export function ImportColumns({
  embedded,
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
  /** Inside the setup guide (already a card). */
  embedded?: boolean;
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
  onRead: (
    mapping: SheetMapping | null,
    labels: AiLabel[],
    readBy: string,
    notes: string[],
  ) => void;
  onChange: (next: {
    sheetIndex?: number;
    mapping?: SheetMapping;
    labels?: Map<string, ValueLabel>;
  }) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = sheets[sheetIndex];
  const width = Math.min(
    60,
    sheet.rows.reduce((w, r) => Math.max(w, r.length), 0),
  );
  const columns = Array.from({ length: width }, (_, c) => c);
  const header = mapping.headerRow >= 0 ? sheet.rows[mapping.headerRow] : null;
  const preview = sheet.rows.slice(mapping.headerRow + 1, mapping.headerRow + 1 + PREVIEW_ROWS);
  const dataRows = sheet.rows.length - (mapping.headerRow + 1);
  const has = (role: ColumnRole) => mapping.roles.includes(role);
  const money =
    has("amount") ||
    has("moneyIn") ||
    has("moneyOut") ||
    (mapping.kind === "budget" && has("allocated"));
  const typeCol = mapping.roles.indexOf("type");
  const typeValues =
    typeCol >= 0
      ? [
          ...new Set(
            sheet.rows
              .slice(mapping.headerRow + 1)
              .map((r) => norm(r[typeCol] ?? ""))
              .filter(Boolean),
          ),
        ].slice(0, 24)
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
      const json = (await res.json().catch(() => null)) as
        (SheetRead & { readBy?: string; error?: string }) | null;
      if (!res.ok || !json)
        throw new Error(json?.error ?? "The sheet couldn't be read. Try again.");
      onRead(
        json.mapping,
        json.labels ?? [],
        json.readBy ?? ai.selected.label,
        json.mapping
          ? json.notes
          : [
              ...json.notes,
              "The model couldn't find money records in this sheet, so the columns were left as they were.",
            ],
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
    <div className="space-y-4.5">
      <ImportPanel embedded={embedded}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="heading text-[17px]">Which column is which?</h2>
            <p className="text-muted-foreground text-sm">
              {fileName} · {dataRows.toLocaleString()} row{dataRows === 1 ? "" : "s"}
              {sheet.truncated ? " (only the first 20,000 are read)" : ""}. Check the guess, or let
              AI read it.
            </p>
          </div>
          {sheets.length > 1 && (
            <Segmented
              label="Sheets"
              className="max-w-full overflow-x-auto"
              value={String(sheetIndex)}
              onSelect={(v) => pickSheet(Number(v))}
              options={sheets.map((s, i) => ({
                value: String(i),
                label: `${s.name}${s.hidden ? " (hidden)" : ""}`,
              }))}
            />
          )}
        </div>

        <section aria-label="Read with AI" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ConnectionPicker
              orgSlug={orgSlug}
              list={ai.list}
              failed={ai.failed}
              selected={ai.selected}
              onChoose={ai.setChoice}
              what="the first rows and each text column's values"
            />
            {ai.selected && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void readWithAi()}
                disabled={reading}
              >
                {reading ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles aria-hidden="true" />
                )}
                {reading
                  ? "Reading…"
                  : readBy
                    ? "Read it again"
                    : `Read it with ${ai.selected.label}`}
              </Button>
            )}
          </div>
          {readBy && (
            <Badge variant="success" className="h-auto min-h-6 py-0.5 whitespace-normal">
              <Check aria-hidden="true" />
              Read by {readBy}
              {categorized > 0
                ? ` · ${categorized} value${categorized === 1 ? "" : "s"} sorted into categories`
                : ""}
            </Badge>
          )}
          {notes.length > 0 && (
            <ul className="text-muted-foreground space-y-1 text-[13px]">
              {notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          )}
          {error && <ErrorNotice>{error}</ErrorNotice>}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5">
            <span className="eyebrow text-muted-foreground block">What&apos;s in it</span>
            <select
              className={fieldSelect}
              value={mapping.kind}
              onChange={(e) => set({ kind: e.target.value as SheetMapping["kind"] })}
            >
              <option value="transactions">Money in and out (a ledger or statement)</option>
              <option value="budget">A budget (an amount per category)</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="eyebrow text-muted-foreground block">Column names are in</span>
            <select
              className={fieldSelect}
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
          {mapping.kind === "transactions" &&
            has("amount") &&
            !has("moneyIn") &&
            !has("moneyOut") && (
              <label className="space-y-1.5">
                <span className="eyebrow text-muted-foreground block">Money in or out</span>
                <select
                  className={fieldSelect}
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
            <label className="space-y-1.5">
              <span className="eyebrow text-muted-foreground block">Dates are written</span>
              <select
                className={fieldSelect}
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

        {mapping.kind === "transactions" &&
          mapping.amountSign === "by-type" &&
          typeValues.length > 0 && (
            <div className="bg-muted/60 rounded-tile space-y-3 p-4">
              <p className="heading text-sm">What does each type mean?</p>
              <ul className="flex flex-wrap gap-2">
                {typeValues.map((v) => {
                  const way = mapping.typeIn.map(norm).includes(v)
                    ? "in"
                    : mapping.typeOut.map(norm).includes(v)
                      ? "out"
                      : "none";
                  return (
                    <li
                      key={v}
                      className="bg-card ring-foreground/6 flex h-10 items-center gap-2 rounded-full pr-1 pl-3.5 text-[13px] ring-1"
                    >
                      <span className="font-semibold">{v}</span>
                      <select
                        aria-label={`${v} means`}
                        className={cn(fieldSelectSm, "rounded-full")}
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
      </ImportPanel>

      <TableFrame bare={embedded}>
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const mapped = (mapping.roles[c] ?? "ignore") !== "ignore";
                return (
                  <TableHead key={c} className="h-auto py-2.5 align-top">
                    <select
                      aria-label={`Column ${c + 1}${header?.[c] ? ` (${header[c]})` : ""}`}
                      className={cn(
                        fieldSelectSm,
                        "w-full min-w-32",
                        mapped
                          ? "text-foreground border-foreground/30 font-semibold"
                          : "text-muted-foreground bg-transparent",
                      )}
                      value={mapping.roles[c] ?? "ignore"}
                      onChange={(e) =>
                        onChange({
                          mapping: setColumnRole(mapping, c, e.target.value as ColumnRole),
                        })
                      }
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1.5 block max-w-48 truncate px-0.5 font-medium">
                      {header?.[c] || `Column ${c + 1}`}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((r, i) => (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell
                    key={c}
                    className={cn(
                      "max-w-56 truncate",
                      mapping.roles[c] === "ignore" && "text-muted-foreground/70",
                    )}
                    title={r[c] ?? ""}
                  >
                    {r[c] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>

      {!money && (
        <WarningNotice>
          Pick the column with the amounts (or the money in and money out columns) to go on.
        </WarningNotice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Choose another file
        </Button>
        <Button type="button" onClick={onContinue} disabled={!money || dataRows <= 0}>
          Review{" "}
          {mapping.kind === "budget"
            ? "the budget"
            : `${dataRows.toLocaleString()} row${dataRows === 1 ? "" : "s"}`}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
