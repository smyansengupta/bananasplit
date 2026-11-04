"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createBudgetPeriod } from "@/app/app/[orgSlug]/finance/periods-actions";
import { saveBudgetLines, setStartingBalance } from "@/app/app/[orgSlug]/finance/setup-actions";
import { changeMemberRole } from "@/app/app/[orgSlug]/settings/members/actions";
import { Plus, Wallet, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { DEFAULT_CATEGORY_NAMES } from "@/lib/finance/default-categories";
import { calendarYear, quarter } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";

export interface SetupMember {
  userId: string;
  name: string;
  role: "OWNER" | "ADMIN" | "TREASURER" | "MEMBER";
}

/** The most a budget line or balance can hold, as Finance's own actions allow. */
const MAX_CENTS = 1_000_000_000;

/** Today in the browser's own calendar (the period is worked out the same way). */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** An action's thrown error (a member who left, a refused role) as words, not a crash. */
function failed(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "That didn't work. Try again.";
}

/** "1,250.50" or "$80" as cents; blank is 0; null when it isn't a number. */
function toCents(value: string): number | null {
  const clean = value.replace(/[$,\s]/g, "");
  if (!clean) return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/**
 * Finance's setup on one screen: quarter or year, what's in the account
 * today, the budget lines (named already, amounts optional) and, if wanted,
 * a member to make a treasurer. One click saves it all through Finance's own
 * actions and opens Finance; everything here changes later in Finance.
 *
 * The steps run one after another, so each one that worked is remembered:
 * trying again after a failure never makes a second budget period. What the
 * actions refuse is checked here first, before anything is saved.
 */
export function FinanceSetup({
  orgId,
  orgSlug,
  members,
  me,
}: {
  orgId: string;
  orgSlug: string;
  members: SetupMember[];
  me: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [by, setBy] = useState<"quarter" | "year">("quarter");
  const [balance, setBalance] = useState("");
  const [lines, setLines] = useState(
    DEFAULT_CATEGORY_NAMES.map((name) => ({ key: name, name, amount: "" })),
  );
  const plain = members.filter((m) => m.role === "MEMBER" && m.userId !== me);
  const [treasurer, setTreasurer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // What's been saved so far, kept across tries; and a guard against a double click.
  const made = useRef<{ periodId: string | null; lines: boolean; balance: boolean }>({
    periodId: null,
    lines: false,
    balance: false,
  });
  const busy = useRef(false);
  const period = by === "quarter" ? quarter() : calendarYear();
  const close = () => {
    setOpen(false);
    router.replace(`/app/${orgSlug}/integrations/finance`, { scroll: false });
  };

  function save() {
    if (busy.current) return;
    setError(null);
    const cents = toCents(balance);
    if (cents === null) return setError("Write the balance as a number, like 4,200.");
    if (Math.abs(cents) > MAX_CENTS) return setError("That balance is too big.");
    const budget: { id: null; name: string; allocatedCents: number }[] = [];
    const seen = new Set<string>();
    for (const l of lines) {
      const name = l.name.trim();
      if (!name) {
        if (l.amount.trim()) return setError("Give every budget line with an amount a name.");
        continue;
      }
      if (name.length > 100) return setError(`Shorten "${name.slice(0, 24)}…" to 100 characters.`);
      if (seen.has(name.toLowerCase())) return setError(`There are two lines called ${name}.`);
      seen.add(name.toLowerCase());
      const c = toCents(l.amount);
      if (c === null || c < 0) return setError(`Write ${name}'s amount as a number.`);
      if (c > MAX_CENTS) return setError(`${name}'s amount is too big.`);
      budget.push({ id: null, name, allocatedCents: c });
    }
    busy.current = true;
    start(async () => {
      try {
        const done = made.current;
        if (!done.periodId) {
          const result = await createBudgetPeriod(orgId, period);
          if (result.error || !result.periodId) return setError(result.error ?? failed(null));
          done.periodId = result.periodId;
        }
        if (!done.lines) {
          const saved = await saveBudgetLines(orgId, done.periodId, budget);
          if (saved?.error) return setError(saved.error);
          done.lines = true;
        }
        if (!done.balance && cents !== 0) {
          const set = await setStartingBalance(orgId, { cents, asOf: localToday() });
          if (set?.error) return setError(set.error);
        }
        done.balance = true;
        if (treasurer) {
          const changed = await changeMemberRole(orgId, treasurer, "TREASURER");
          if (changed?.error) return setError(changed.error);
        }
        router.push(`/app/${orgSlug}/finance`);
        router.refresh();
      } catch (e) {
        setError(failed(e));
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="gap-5 sm:max-w-[600px]">
        <DialogHeader className="flex-row items-start gap-4 text-left">
          <span className="bg-tint-success text-tint-success-foreground grid size-12 shrink-0 place-items-center rounded-2xl">
            <Wallet className="size-6" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="heading text-[24px]">Set up Finance</DialogTitle>
            <DialogDescription>
              We filled in what we could. Change anything, then save.
            </DialogDescription>
          </span>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13.5px] font-semibold">Budgets run by</span>
          <div className={segmentedTrack} role="group" aria-label="Budgets run by">
            {(["quarter", "year"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={by === k}
                className={segmentedItem(by === k)}
                onClick={() => setBy(k)}
              >
                {k === "quarter" ? "Quarter" : "Year"}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13.5px] font-semibold">In the account today</span>
          <span className="relative w-44">
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm font-semibold">
              $
            </span>
            <Input
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="0"
              className="pl-7 text-right"
            />
          </span>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13.5px] font-semibold">
            Budget lines{" "}
            <span className="text-muted-foreground font-normal">
              for {period.label}. Leave any amount blank for now.
            </span>
          </legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lines.map((l, i) => (
              <li
                key={l.key}
                className="bg-muted/55 flex h-12 items-center gap-1.5 rounded-xl pr-1 pl-1.5"
              >
                <input
                  aria-label="Budget line name"
                  value={l.name}
                  onChange={(e) =>
                    setLines((all) =>
                      all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  className="focus-glow h-10 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm font-semibold outline-none"
                />
                <input
                  aria-label={`${l.name || "Line"} amount`}
                  inputMode="decimal"
                  placeholder="$"
                  value={l.amount}
                  onChange={(e) =>
                    setLines((all) =>
                      all.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                  className="border-border bg-card focus-glow h-10 w-24 rounded-lg border px-2.5 text-right text-sm outline-none"
                />
                <button
                  type="button"
                  aria-label={`Remove ${l.name || "this line"}`}
                  onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground focus-glow grid size-10 shrink-0 place-items-center rounded-full outline-none"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() =>
                  setLines((all) => [...all, { key: `new-${all.length}`, name: "", amount: "" }])
                }
                className="text-muted-foreground hover:bg-muted/60 focus-glow flex h-12 w-full items-center gap-2 rounded-xl border border-dashed px-3 text-sm font-semibold outline-none"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add a line
              </button>
            </li>
          </ul>
        </fieldset>

        <label className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13.5px] font-semibold">Make someone a treasurer</span>
          <select
            value={treasurer}
            onChange={(e) => setTreasurer(e.target.value)}
            className="border-border bg-card focus-glow h-10 w-64 max-w-full rounded-xl border px-3 text-sm outline-none"
          >
            <option value="">Nobody new</option>
            {plain.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground -mt-2 text-[12.5px] leading-relaxed">
          Owners, admins and treasurers see the books and approve reimbursements. Everyone else can
          submit expenses from New.
        </p>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Not now
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={pending}
            className={cn(pending && "opacity-70")}
          >
            {pending ? "Setting up…" : "Save and open Finance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
