"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Copy,
  Loader2,
  TriangleAlert,
  Upload,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  checkImportDuplicates,
  importFinanceBudget,
  importFinanceRecords,
} from "@/app/app/[orgSlug]/finance/import-actions";
import { TableFrame } from "@/components/databases/table-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionKind } from "@/generated/prisma/enums";
import {
  inferKind,
  isImportable,
  kindFits,
  rowProblems,
  type BudgetLine,
  type Direction,
  type ImportRow,
} from "@/lib/finance/import/mapping";
import { planPeriods, type PeriodLike } from "@/lib/finance/import/plan";
import { parseAmount } from "@/lib/finance/import/values";
import { formatCents } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

import type { ImportSummary } from "./import-done";
import {
  ErrorNotice,
  fieldSelect,
  fieldSelectSm,
  HatchProgress,
  ImportPanel,
  ReadNotes,
  WarningNotice,
} from "./panel";

/**
 * Every proposed row, editable, before anything is saved: tick what goes
 * in, fix a date, an amount, which way the money went, its type or its
 * category. Rows already in the books (same day, amount and direction) are
 * unticked; so are totals and rows missing a date or an amount. Big imports
 * are sent in parts that share one batch id, so Undo takes them all back.
 */

const PAGE = 100;
const CHUNK = 500;

export const KIND_LABEL: Record<string, string> = {
  [TransactionKind.EXPENSE]: "Expense",
  [TransactionKind.SPONSORSHIP]: "Sponsorship",
  [TransactionKind.OTHER_INCOME]: "Income (dues, sales…)",
  [TransactionKind.ALLOCATION]: "School funding",
  [TransactionKind.ADJUSTMENT]: "Adjustment",
};
const KINDS = Object.keys(KIND_LABEL) as TransactionKind[];

type Filter = "all" | "import" | "skipped" | "duplicates";

const dupKey = (r: Pick<ImportRow, "date" | "amountCents" | "direction">) =>
  `${r.date}|${r.amountCents}|${r.direction}`;

function newBatchId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

const dollars = (cents: number | null) =>
  cents === null ? "" : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** A figure on an inset tile: the label above, the number in the display face. */
function Figure({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="bg-muted/60 rounded-tile min-w-28 px-4 py-3">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className={cn("numeral mt-1.5 text-[22px]", className)}>{children}</dd>
    </div>
  );
}

export function ImportReview({
  embedded,
  orgId,
  fileName,
  initialRows,
  periods,
  categories,
  readBy,
  notes,
  onBack,
  onDone,
}: {
  /** Inside the setup guide (already a card). */
  embedded?: boolean;
  orgId: string;
  orgSlug: string;
  fileName: string;
  initialRows: ImportRow[];
  periods: PeriodLike[];
  categories: { name: string; budgetPeriodId: string }[];
  readBy: string | null;
  notes: string[];
  onBack: () => void;
  onDone: (summary: ImportSummary) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [createPeriods, setCreatePeriods] = useState(true);
  const [createCategories, setCreateCategories] = useState(true);
  const [reconciled, setReconciled] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rows that are already in the books start unticked (importing an export twice shouldn't double the money).
  useEffect(() => {
    let live = true;
    const keys = initialRows
      .filter((r) => r.date && r.amountCents && r.direction)
      .map((r) => ({ date: r.date!, amountCents: r.amountCents!, direction: r.direction! }));
    if (keys.length === 0) return;
    checkImportDuplicates(orgId, keys.slice(0, 5000))
      .then((res) => {
        if (!live || !res.duplicates?.length) return;
        const found = new Set(res.duplicates);
        setDuplicates(found);
        setRows((rs) => rs.map((r) => (found.has(dupKey(r)) ? { ...r, include: false } : r)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [initialRows, orgId]);

  const patch = (key: string, change: Partial<ImportRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const chosen = rows.filter((r) => r.include && isImportable(r));
  const totals = chosen.reduce(
    (t, r) =>
      r.direction === "IN"
        ? { ...t, in: t.in + r.amountCents! }
        : { ...t, out: t.out + r.amountCents! },
    { in: 0, out: 0 },
  );
  const plan = planPeriods(
    periods,
    chosen.map((r) => r.date!),
  );
  const periodLabel = (date: string | null) => {
    if (!date) return null;
    const target = plan.targets.get(date);
    if (!target) return null;
    return "existing" in target
      ? { label: periods.find((p) => p.id === target.existing)?.label ?? "", isNew: false }
      : { label: target.draft.label, isNew: true };
  };
  const byPeriod = new Map<string, { count: number; isNew: boolean }>();
  for (const r of chosen) {
    const p = periodLabel(r.date);
    if (!p) continue;
    const entry = byPeriod.get(p.label) ?? { count: 0, isNew: p.isNew };
    entry.count++;
    byPeriod.set(p.label, entry);
  }
  const known = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of categories) {
      const set = m.get(c.budgetPeriodId) ?? new Set<string>();
      set.add(c.name.trim().toLowerCase());
      m.set(c.budgetPeriodId, set);
    }
    return m;
  }, [categories]);
  const categoryNames = useMemo(
    () =>
      [
        ...new Set(
          [...categories.map((c) => c.name), ...rows.map((r) => r.category ?? "")].filter(Boolean),
        ),
      ].sort(),
    [categories, rows],
  );
  const isNewCategory = (r: ImportRow) => {
    if (!r.category || !r.date) return false;
    const target = plan.targets.get(r.date);
    if (!target || !("existing" in target)) return true;
    return !known.get(target.existing)?.has(r.category.trim().toLowerCase());
  };

  const visible = rows.filter((r) => {
    if (filter === "import") return r.include && isImportable(r);
    if (filter === "skipped") return !r.include || !isImportable(r);
    if (filter === "duplicates") return duplicates.has(dupKey(r));
    return true;
  });
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE);
  const skippedCount = rows.length - chosen.length;
  const needsDraft = !createPeriods && plan.drafts.length > 0;

  async function runImport() {
    setError(null);
    const records = chosen.map((r) => ({
      date: r.date!,
      description: r.description.trim().slice(0, 500) || "Imported transaction",
      amountCents: r.amountCents!,
      direction: r.direction!,
      kind: r.kind,
      category: r.category?.trim() || null,
      counterparty: r.counterparty?.trim() || null,
      paymentMethod: r.paymentMethod?.trim() || null,
    }));
    const batch = newBatchId();
    const summary: Extract<ImportSummary, { kind: "transactions" }> = {
      kind: "transactions",
      batch,
      created: 0,
      skipped: [],
      periods: [],
      categoriesCreated: [],
      inCents: 0,
      outCents: 0,
    };
    for (let at = 0; at < records.length; at += CHUNK) {
      const part = records.slice(at, at + CHUNK);
      setProgress({ done: at, total: records.length });
      setBusy(
        records.length > CHUNK
          ? `Importing ${Math.min(at + CHUNK, records.length).toLocaleString()} of ${records.length.toLocaleString()}…`
          : "Importing…",
      );
      try {
        const res = await importFinanceRecords(orgId, {
          batch,
          source: fileName.slice(0, 120),
          records: part,
          createPeriods,
          createCategories,
          reconciled,
        });
        if (res.error || !res.outcome)
          throw new Error(res.error ?? "The import stopped. Try again.");
        const o = res.outcome;
        summary.created += o.created;
        summary.skipped.push(...o.skipped.map((s) => ({ ...s, index: s.index + at })));
        for (const p of o.periods) {
          const same = summary.periods.find((x) => x.label === p.label);
          if (same) same.count += p.count;
          else summary.periods.push({ ...p });
        }
        for (const c of o.categoriesCreated)
          if (!summary.categoriesCreated.includes(c)) summary.categoriesCreated.push(c);
      } catch (e) {
        setBusy(null);
        setProgress(null);
        setError(
          `${e instanceof Error ? e.message : "The import stopped."}${summary.created > 0 ? ` ${summary.created} rows went in before it stopped: the next screen can undo them.` : ""}`,
        );
        if (summary.created > 0) onDone({ ...summary, partial: true });
        return;
      }
    }
    for (const [i, r] of records.entries()) {
      if (summary.skipped.some((s) => s.index === i)) continue;
      if (r.direction === "IN") summary.inCents += r.amountCents;
      else summary.outCents += r.amountCents;
    }
    setBusy(null);
    setProgress(null);
    router.refresh();
    onDone(summary);
  }

  function applyBulkCategory() {
    const name = bulkCategory.trim();
    if (!name) return;
    setRows((rs) => rs.map((r) => (r.include ? { ...r, category: name.slice(0, 60) } : r)));
    setBulkCategory("");
  }

  const FILTERS: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: rows.length },
    { id: "import", label: "Importing", count: chosen.length },
    { id: "skipped", label: "Left out", count: skippedCount },
    ...(duplicates.size > 0
      ? [
          {
            id: "duplicates" as const,
            label: "Already recorded",
            count: rows.filter((r) => duplicates.has(dupKey(r))).length,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4.5">
      <ImportPanel embedded={embedded}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl min-w-0 space-y-1">
            <h2 className="heading text-[17px]">Check the rows</h2>
            <p className="text-muted-foreground text-sm">
              Nothing is saved until you import. Untick anything that shouldn&apos;t go in, and fix
              what looks wrong.
            </p>
          </div>
          <dl className="flex flex-wrap gap-2">
            <Figure label="Importing">{chosen.length.toLocaleString()}</Figure>
            <Figure label="Money in">{formatCents(totals.in)}</Figure>
            <Figure label="Money out">{formatCents(totals.out)}</Figure>
          </dl>
        </div>

        <ReadNotes readBy={readBy} notes={notes} />

        {byPeriod.size > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">Goes into </span>
            {[...byPeriod.entries()].map(([label, p], i) => (
              <span key={label}>
                {i > 0 && <span className="text-muted-foreground">, </span>}
                <span className="font-semibold">{label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {" "}
                  ({p.count.toLocaleString()}
                  {p.isNew ? (createPeriods ? ", a new budget year" : ", no period: left out") : ""}
                  )
                </span>
              </span>
            ))}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="Show rows"
            className="max-w-full overflow-x-auto"
            value={filter}
            onSelect={(v) => {
              setFilter(v as Filter);
              setPage(0);
            }}
            options={FILTERS.map((f) => ({
              value: f.id,
              label: (
                <>
                  {f.label}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    {f.count.toLocaleString()}
                  </span>
                </>
              ),
            }))}
          />
          <div className="flex items-center gap-2">
            <Input
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              placeholder="Category for every ticked row"
              aria-label="Category for every ticked row"
              list="import-categories"
              className="w-60"
            />
            <Button
              type="button"
              variant="outline"
              onClick={applyBulkCategory}
              disabled={!bulkCategory.trim()}
            >
              Apply
            </Button>
          </div>
        </div>
      </ImportPanel>

      <datalist id="import-categories">
        {categoryNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <TableFrame bare={embedded}>
        <Table className="min-w-[56rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">Import</span>
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right tabular-nums">Amount</TableHead>
              <TableHead>Way</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const problems = rowProblems(r);
              const dup = duplicates.has(dupKey(r));
              return (
                <TableRow
                  key={r.key}
                  className={cn(
                    "[&>td]:py-2.5 [&>td]:align-top",
                    !r.include && "bg-muted/40 text-muted-foreground",
                  )}
                >
                  <TableCell className="pt-4!">
                    <Checkbox
                      checked={r.include}
                      onCheckedChange={(v) => patch(r.key, { include: v === true })}
                      aria-label={`Import ${r.source}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={r.date ?? ""}
                      onChange={(e) => patch(r.key, { date: e.target.value || null })}
                      className="h-8 w-38 text-[13px]"
                      aria-label={`Date, ${r.source}`}
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Input
                      value={r.description}
                      onChange={(e) => patch(r.key, { description: e.target.value })}
                      className="h-8 min-w-56 text-[13px]"
                      aria-label={`Description, ${r.source}`}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground text-xs">
                        {r.source}
                        {r.counterparty ? ` · ${r.counterparty}` : ""}
                      </span>
                      {dup && (
                        <Badge variant="info">
                          <Copy aria-hidden="true" />
                          Already recorded?
                        </Badge>
                      )}
                      {problems.map((p) => (
                        <Badge key={p} variant="secondary" className="text-foreground">
                          <TriangleAlert className="text-warning" aria-hidden="true" />
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Input
                      key={`${r.key}-${r.amountCents}`}
                      defaultValue={dollars(r.amountCents)}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const a = parseAmount(e.target.value);
                        patch(r.key, { amountCents: a && a.cents > 0 ? a.cents : null });
                      }}
                      className="ml-auto h-8 w-28 text-right text-[13px] tabular-nums"
                      aria-label={`Amount, ${r.source}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn("w-20", r.direction === "IN" && "text-success")}
                      onClick={() => {
                        const direction: Direction = r.direction === "IN" ? "OUT" : "IN";
                        patch(r.key, {
                          direction,
                          kind: kindFits(r.kind, direction)
                            ? r.kind
                            : inferKind(direction, `${r.description} ${r.category ?? ""}`),
                        });
                      }}
                      aria-label={`${r.direction === "IN" ? "Money in" : r.direction === "OUT" ? "Money out" : "Not set"}, ${r.source}. Switch.`}
                    >
                      {r.direction === "IN" ? (
                        <ArrowDownLeft aria-hidden="true" />
                      ) : (
                        <ArrowUpRight aria-hidden="true" />
                      )}
                      {r.direction === "IN" ? "In" : r.direction === "OUT" ? "Out" : "Set"}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <select
                      className={fieldSelectSm}
                      value={r.kind}
                      onChange={(e) => patch(r.key, { kind: e.target.value as TransactionKind })}
                      aria-label={`Type, ${r.source}`}
                    >
                      {KINDS.filter((k) => !r.direction || kindFits(k, r.direction)).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.category ?? ""}
                      onChange={(e) => patch(r.key, { category: e.target.value || null })}
                      list="import-categories"
                      placeholder="None"
                      className="h-8 w-40 text-[13px]"
                      aria-label={`Category, ${r.source}`}
                    />
                    {r.category && isNewCategory(r) && (
                      <span className="text-muted-foreground mt-1.5 block text-xs">
                        {createCategories ? "New category" : "Not a category yet: left blank"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {shown.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  No rows here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableFrame>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[13px]">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground tabular-nums">
            Page {page + 1} of {pages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <ImportPanel embedded={embedded}>
        <fieldset className="space-y-3.5">
          <legend className="heading mb-3.5 text-[15px]">When importing</legend>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={createPeriods}
              onCheckedChange={(v) => setCreatePeriods(v === true)}
              className="mt-0.5"
            />
            <span>
              Add budget years for dates outside your budget periods
              <span className="text-muted-foreground block text-[13px]">
                Past years are kept separate, so this year&apos;s balance only counts this year.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={createCategories}
              onCheckedChange={(v) => setCreateCategories(v === true)}
              className="mt-0.5"
            />
            <span>
              Add categories that don&apos;t exist yet (at $0 budgeted)
              <span className="text-muted-foreground block text-[13px]">
                Otherwise those rows go in uncategorized.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={reconciled}
              onCheckedChange={(v) => setReconciled(v === true)}
              className="mt-0.5"
            />
            <span>
              These match the bank: mark them reconciled
              <span className="text-muted-foreground block text-[13px]">
                Reconciled rows are locked against edits. Leave this off if you might still fix
                things.
              </span>
            </span>
          </label>
        </fieldset>
      </ImportPanel>

      {needsDraft && (
        <WarningNotice>
          Some dates aren&apos;t in any budget period, so those rows will be left out. Tick
          &ldquo;Add budget years&rdquo; to keep them.
        </WarningNotice>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {progress && busy && (
        <HatchProgress
          done={progress.done}
          total={progress.total}
          label={
            progress.total > CHUNK
              ? busy
              : `Importing ${progress.total.toLocaleString()} transaction${progress.total === 1 ? "" : "s"}…`
          }
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy !== null}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <Button
          type="button"
          onClick={() => void runImport()}
          disabled={busy !== null || chosen.length === 0}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {busy ??
            `Import ${chosen.length.toLocaleString()} transaction${chosen.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

export function BudgetReview({
  embedded,
  orgId,
  initialLines,
  periods,
  readBy,
  notes,
  onBack,
  onDone,
}: {
  embedded?: boolean;
  orgId: string;
  initialLines: BudgetLine[];
  periods: PeriodLike[];
  readBy: string | null;
  notes: string[];
  onBack: () => void;
  onDone: (summary: ImportSummary) => void;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const active = periods.find((p) => p.isActive) ?? null;
  const [periodId, setPeriodId] = useState<string>(active?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = lines.filter((l) => l.include && l.name.trim() && l.allocatedCents !== null);
  const total = chosen.reduce((s, l) => s + (l.allocatedCents ?? 0), 0);
  const patch = (key: string, change: Partial<BudgetLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await importFinanceBudget(orgId, {
      periodId: periodId || null,
      lines: chosen.map((l) => ({
        name: l.name.trim().slice(0, 100),
        allocatedCents: l.allocatedCents ?? 0,
      })),
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
    onDone({
      kind: "budget",
      periodLabel: res.periodLabel ?? "",
      updated: res.updated ?? 0,
      created: res.created ?? 0,
      totalCents: total,
    });
  }

  return (
    <div className="space-y-4.5">
      <ImportPanel embedded={embedded}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl min-w-0 space-y-1">
            <h2 className="heading text-[17px]">A budget: check the lines</h2>
            <p className="text-muted-foreground text-sm">
              Each line becomes a budget category with that amount. Lines with the same name as a
              category update it.
            </p>
          </div>
          <dl className="flex flex-wrap gap-2">
            <Figure label="Total budgeted">{formatCents(total)}</Figure>
          </dl>
        </div>
        <ReadNotes readBy={readBy} notes={notes} />
        <label className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Put it in</span>
          <select
            className={cn(fieldSelect, "w-auto min-w-56")}
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            {!active && <option value="">This school year (new)</option>}
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.isActive ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
        <ul className="divide-border/70 -mx-2 divide-y">
          {lines.map((l) => (
            <li
              key={l.key}
              className={cn(
                "hover:bg-muted/60 rounded-field flex flex-wrap items-center gap-3 px-2 py-2 transition-colors",
                !l.include && "text-muted-foreground",
              )}
            >
              <Checkbox
                checked={l.include}
                onCheckedChange={(v) => patch(l.key, { include: v === true })}
                aria-label={`Include ${l.name}`}
              />
              <Input
                value={l.name}
                onChange={(e) => patch(l.key, { name: e.target.value })}
                className="min-w-48 flex-1"
                aria-label={`Name, ${l.source}`}
              />
              <Input
                key={`${l.key}-${l.allocatedCents}`}
                defaultValue={dollars(l.allocatedCents)}
                inputMode="decimal"
                onBlur={(e) => {
                  const a = parseAmount(e.target.value);
                  patch(l.key, { allocatedCents: a ? a.cents : null });
                }}
                className="w-32 text-right tabular-nums"
                aria-label={`Amount, ${l.source}`}
              />
            </li>
          ))}
        </ul>
      </ImportPanel>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy || chosen.length === 0}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          Save {chosen.length} budget line{chosen.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
