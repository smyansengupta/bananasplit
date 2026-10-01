"use client";

import { CalendarRange, Check, Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createBudgetPeriod,
  createCategory,
  deleteBudgetPeriod,
  deleteCategory,
  setActivePeriod,
  updateBudgetPeriod,
  updateCategory,
} from "@/app/app/[orgSlug]/finance/periods-actions";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";
import { formatPeriodRange, PERIOD_PRESETS, type PeriodDraft } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";

export interface BudgetPeriodRow {
  id: string;
  label: string;
  /** YYYY-MM-DD */
  startsOn: string;
  /** YYYY-MM-DD */
  endsOn: string;
  isActive: boolean;
}

export interface BudgetCategoryRow {
  id: string;
  name: string;
  allocatedCents: number;
  /** Money out filed under it this period (what counts toward the balance). */
  spentCents: number;
  /** Every transaction filed under it (they become uncategorized if it goes). */
  transactionCount: number;
}

/**
 * Finance > Budget: the periods (school year, semester...) and, for the
 * active one, each category's budget against what's been spent. Every field
 * says what it is, new periods start from a preset, and everything can be
 * renamed, moved or deleted.
 */
export function BudgetView({
  orgId,
  periods,
  activePeriodId,
  categories,
}: {
  orgId: string;
  periods: BudgetPeriodRow[];
  activePeriodId: string | null;
  categories: BudgetCategoryRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BudgetPeriodRow | "new" | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const active = periods.find((p) => p.id === activePeriodId) ?? null;

  function run(task: () => Promise<{ error?: string }>, success?: string) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (success) toast({ title: success, tone: "success", duration: 3_000 });
      router.refresh();
    });
  }

  async function removePeriod(p: BudgetPeriodRow) {
    const ok = await confirm({
      title: `Delete the period “${p.label}”?`,
      description: "Its categories go with it. A period that already has transactions or sponsorships can't be deleted.",
      confirmLabel: "Delete period",
      run: async () => (await deleteBudgetPeriod(orgId, p.id)).error,
    });
    if (ok) {
      toast({ title: `Deleted “${p.label}”` });
      router.refresh();
    }
  }

  async function removeCategory(c: BudgetCategoryRow) {
    const n = c.transactionCount;
    const ok = await confirm({
      title: `Delete the category “${c.name}”?`,
      description:
        n > 0
          ? `${n} transaction${n === 1 ? " is" : "s are"} filed under it. ${n === 1 ? "It stays" : "They stay"} in every total, just uncategorized.`
          : "Nothing is filed under it yet.",
      confirmLabel: "Delete category",
      run: async () => (await deleteCategory(orgId, c.id)).error,
    });
    if (ok) {
      toast({ title: `Deleted “${c.name}”` });
      router.refresh();
    }
  }

  const totals = categories.reduce(
    (t, c) => ({ budget: t.budget + c.allocatedCents, spent: t.spent + c.spentCents }),
    { budget: 0, spent: 0 },
  );

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-xl border">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-medium">Budget periods</h2>
            <p className="text-muted-foreground text-xs">
              The stretch of time a budget covers. Money goes into the active one.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden="true" />
            New period
          </Button>
        </header>
        {periods.length === 0 ? (
          <div className="p-4">
            <EmptyState
              size="compact"
              icon={CalendarRange}
              title="No budget period yet"
              description="Start one for this school year in a click, or pick your own dates."
              action={
                <Button onClick={() => setEditing("new")}>
                  <Plus className="size-4" aria-hidden="true" />
                  New period
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y">
            {periods.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    p.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  <CalendarRange className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {p.label}
                    {p.isActive && (
                      <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold">
                        Active
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">{formatPeriodRange(p.startsOn, p.endsOn)}</p>
                </div>
                {!p.isActive && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => run(() => setActivePeriod(orgId, p.id), `${p.label} is now active`)}
                  >
                    <Star className="size-3.5" aria-hidden="true" />
                    Make active
                  </Button>
                )}
                <ItemMenu
                  label={`Actions for ${p.label}`}
                  items={[
                    { label: "Rename or change dates", icon: Pencil, onSelect: () => setEditing(p) },
                    { label: "Delete period", icon: Trash2, destructive: true, onSelect: () => void removePeriod(p) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {active && (
        <section className="bg-card rounded-xl border">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-medium">Categories · {active.label}</h2>
              <p className="text-muted-foreground text-xs">
                Set how much each category may spend. Type a number and click away to save.
              </p>
            </div>
            <dl className="flex gap-5 text-right text-xs">
              <div>
                <dt className="text-muted-foreground">Budgeted</dt>
                <dd className="text-sm font-semibold tabular-nums">{formatCents(totals.budget)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Spent</dt>
                <dd className="text-sm font-semibold tabular-nums">{formatCents(totals.spent)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Left</dt>
                <dd
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    totals.budget - totals.spent < 0 && "text-destructive",
                  )}
                >
                  {formatCents(totals.budget - totals.spent)}
                </dd>
              </div>
            </dl>
          </header>
          <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_2rem] gap-3 px-4 pt-3 text-xs font-medium sm:grid">
            <span>Category</span>
            <span>Budget</span>
            <span className="text-right">Spent</span>
            <span className="text-right">Left</span>
            <span />
          </div>
          <ul className="divide-y">
            {categories.map((c) => (
              <CategoryRow key={c.id} orgId={orgId} category={c} onDelete={() => void removeCategory(c)} />
            ))}
          </ul>
          <NewCategory orgId={orgId} periodId={active.id} />
        </section>
      )}

      <PeriodDialog
        orgId={orgId}
        period={editing}
        onClose={() => setEditing(null)}
        onSaved={(label, isNew) => {
          setEditing(null);
          toast({ title: isNew ? `${label} is set up and active` : `Saved ${label}`, tone: "success" });
          router.refresh();
        }}
      />
      {confirmEl}
    </div>
  );
}

function CategoryRow({
  orgId,
  category,
  onDelete,
}: {
  orgId: string;
  category: BudgetCategoryRow;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [amount, setAmount] = useState((category.allocatedCents / 100).toFixed(2));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const left = category.allocatedCents - category.spentCents;
  const used = category.allocatedCents > 0 ? Math.min(1, category.spentCents / category.allocatedCents) : 0;

  async function save(patch: { name?: string; allocatedCents?: number }) {
    setState("saving");
    setMessage(null);
    const result = await updateCategory(orgId, category.id, patch);
    if (result.error) {
      setState("error");
      setMessage(result.error);
      return;
    }
    setState("saved");
    router.refresh();
    setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1_500);
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_2rem]">
      <div className="min-w-0">
        <Label htmlFor={`cat-name-${category.id}`} className="sr-only">
          Category name
        </Label>
        <Input
          id={`cat-name-${category.id}`}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (!next) setName(category.name);
            else if (next !== category.name) void save({ name: next });
          }}
          className="h-8 border-transparent px-1.5 font-medium shadow-none hover:border-input focus-visible:border-input"
        />
        <div className="bg-muted mt-1 h-1 overflow-hidden rounded-full" aria-hidden="true">
          <div
            className={cn("h-full rounded-full", left < 0 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.round(used * 100)}%` }}
          />
        </div>
      </div>
      <div className="relative">
        <Label htmlFor={`cat-budget-${category.id}`} className="sr-only">
          Budget for {category.name}
        </Label>
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm">
          $
        </span>
        <Input
          id={`cat-budget-${category.id}`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            let cents: number;
            try {
              cents = parseDollarsToCents(amount || "0");
            } catch {
              setState("error");
              setMessage("Enter an amount like 250 or 250.00.");
              return;
            }
            setAmount((cents / 100).toFixed(2));
            if (cents !== category.allocatedCents) void save({ allocatedCents: cents });
          }}
          className="h-8 pl-5 tabular-nums"
        />
        <span className="absolute top-1/2 -right-5 -translate-y-1/2" aria-live="polite">
          {state === "saving" && <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-label="Saving" />}
          {state === "saved" && <Check className="text-success size-3.5" aria-label="Saved" />}
        </span>
      </div>
      <span className="text-muted-foreground hidden text-right text-sm tabular-nums sm:block">
        {formatCents(category.spentCents)}
      </span>
      <span
        className={cn("hidden text-right text-sm tabular-nums sm:block", left < 0 && "text-destructive font-medium")}
      >
        {formatCents(left)}
      </span>
      <ItemMenu
        label={`Actions for ${category.name}`}
        items={[{ label: "Delete category", icon: Trash2, destructive: true, onSelect: onDelete }]}
      />
      {message && <p className="text-destructive col-span-full text-xs">{message}</p>}
    </li>
  );
}

function NewCategory({ orgId, periodId }: { orgId: string; periodId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    let cents = 0;
    try {
      cents = parseDollarsToCents(amount || "0");
    } catch {
      setError("Enter an amount like 250 or 250.00.");
      return;
    }
    start(async () => {
      const result = await createCategory(orgId, periodId, { name: name.trim(), allocatedCents: cents });
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      setAmount("");
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) add();
      }}
    >
      <Input
        placeholder="New category, e.g. Merch"
        aria-label="New category name"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        className="h-8 min-w-40 flex-1"
      />
      <div className="relative w-32">
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm">
          $
        </span>
        <Input
          placeholder="0.00"
          aria-label="Its budget"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 pl-5"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
        Add category
      </Button>
      {error && <p className="text-destructive w-full text-xs">{error}</p>}
    </form>
  );
}

function PeriodDialog({
  orgId,
  period,
  onClose,
  onSaved,
}: {
  orgId: string;
  period: BudgetPeriodRow | "new" | null;
  onClose: () => void;
  onSaved: (label: string, isNew: boolean) => void;
}) {
  const isNew = period === "new";
  const open = period !== null;
  // The form starts from the period being edited, or the school-year preset.
  const initial: PeriodDraft =
    period && period !== "new"
      ? { label: period.label, startsOn: period.startsOn, endsOn: period.endsOn }
      : PERIOD_PRESETS[0].make();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <PeriodForm
            key={period === "new" ? "new" : period.id}
            orgId={orgId}
            periodId={isNew ? null : (period as BudgetPeriodRow).id}
            initial={initial}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PeriodForm({
  orgId,
  periodId,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  periodId: string | null;
  initial: PeriodDraft;
  onClose: () => void;
  onSaved: (label: string, isNew: boolean) => void;
}) {
  const [draft, setDraft] = useState<PeriodDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isNew = periodId === null;

  function save() {
    setError(null);
    start(async () => {
      const result = isNew
        ? await createBudgetPeriod(orgId, draft)
        : await updateBudgetPeriod(orgId, periodId, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved(draft.label.trim(), isNew);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{isNew ? "New budget period" : "Edit budget period"}</DialogTitle>
        <DialogDescription>
          {isNew
            ? "It becomes the active period, with the same categories as the last one (budgets start at zero)."
            : "Transactions stay in this period whatever the dates."}
        </DialogDescription>
      </DialogHeader>
      {isNew && (
        <div className="grid gap-2 sm:grid-cols-3">
          {PERIOD_PRESETS.map((preset) => {
            const made = preset.make();
            const selected = made.startsOn === draft.startsOn && made.endsOn === draft.endsOn;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft(made)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  selected ? "border-primary bg-primary/5 ring-primary/20 ring-2" : "hover:bg-muted/60",
                )}
              >
                <span className="block font-medium">{preset.name}</span>
                <span className="text-muted-foreground block text-xs">{made.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="period-label">Name</Label>
        <Input
          id="period-label"
          value={draft.label}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="e.g. 2026–27 or Fall 2026"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="period-start">Starts</Label>
          <Input
            id="period-start"
            type="date"
            value={draft.startsOn}
            onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="period-end">Ends</Label>
          <Input
            id="period-end"
            type="date"
            value={draft.endsOn}
            onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !draft.label.trim() || !draft.startsOn || !draft.endsOn}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {isNew ? "Create and make active" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
