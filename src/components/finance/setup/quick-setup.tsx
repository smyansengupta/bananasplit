"use client";

import { Loader2, Plus, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveBudgetLines, setStartingBalance } from "@/app/app/[orgSlug]/finance/setup-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { parseAmount } from "@/lib/finance/import/values";
import { SUGGESTED_CATEGORIES, type FinanceSetupState } from "@/lib/finance/setup";
import { cn } from "@/lib/utils";

interface Line {
  /** The BudgetCategory, once saved. */
  id: string | null;
  name: string;
  /** What was typed ("400", "1,250.50"). */
  amount: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

/**
 * Finance setup on one screen: what the organization has now, its budget
 * lines (with suggestions to add in a click), and one Save. The budget year
 * starts on its own the first time anything is saved; past records and a
 * treasurer are a link away, not steps to walk through.
 */
export function QuickFinanceSetup({
  orgId,
  orgSlug,
  today,
  state,
  lines: initialLines,
}: {
  orgId: string;
  orgSlug: string;
  today: string;
  state: FinanceSetupState;
  lines: { id: string; name: string; allocatedCents: number }[];
}) {
  const router = useRouter();
  const [have, setHave] = useState(
    state.startingBalance ? dollars(state.startingBalance.cents) : "",
  );
  const [lines, setLines] = useState<Line[]>(
    initialLines.length
      ? initialLines.map((l) => ({ id: l.id, name: l.name, amount: dollars(l.allocatedCents) }))
      : [{ id: null, name: "", amount: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const base = `/app/${orgSlug}/finance`;
  const taken = new Set(lines.map((l) => l.name.trim().toLowerCase()));
  const suggestions = SUGGESTED_CATEGORIES.filter((n) => !taken.has(n.toLowerCase()));

  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function addSuggestion(name: string) {
    setLines((ls) => {
      const blank = ls.findIndex((l) => !l.name.trim() && !l.amount.trim());
      if (blank !== -1) return ls.map((l, j) => (j === blank ? { ...l, name } : l));
      return [...ls, { id: null, name, amount: "" }];
    });
  }

  function save() {
    setError(null);
    const signed = (raw: string) => {
      const a = parseAmount(raw);
      return a ? (a.negative ? -a.cents : a.cents) : null;
    };
    const cents = have.trim() ? signed(have) : 0;
    if (cents === null) {
      setError("Enter what you have as an amount, like 1,240.");
      return;
    }
    const kept = lines.filter((l) => l.name.trim() || l.amount.trim());
    const parsed = kept.map((l) => ({
      id: l.id,
      name: l.name.trim(),
      allocatedCents: l.amount.trim() ? signed(l.amount) : 0,
    }));
    if (parsed.some((l) => l.allocatedCents === null || (l.allocatedCents ?? 0) < 0)) {
      setError("Budget amounts are numbers, like 400.");
      return;
    }
    if (parsed.some((l) => !l.name)) {
      setError("Give every budget line a name.");
      return;
    }
    start(async () => {
      const balance = await setStartingBalance(orgId, { cents, asOf: today });
      if (balance.error) {
        setError(balance.error);
        return;
      }
      const saved = await saveBudgetLines(
        orgId,
        state.period?.id ?? null,
        parsed as { id: string | null; name: string; allocatedCents: number }[],
      );
      if (saved.error) {
        setError(saved.error);
        return;
      }
      toast({
        title: "Saved",
        description: saved.kept
          ? `${saved.kept} line${saved.kept === 1 ? " is" : "s are"} in use, so ${saved.kept === 1 ? "it stays" : "they stay"}.`
          : undefined,
      });
      router.push(base);
      router.refresh();
    });
  }

  return (
    <div className="bg-card text-card-foreground edge rounded-card max-w-2xl space-y-6 p-6">
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="setup-have">You have</Label>
        <div className="relative">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
            $
          </span>
          <Input
            id="setup-have"
            inputMode="decimal"
            value={have}
            onChange={(e) => setHave(e.target.value)}
            placeholder="0"
            className="ps-7 tabular-nums"
          />
        </div>
        <p className="text-muted-foreground text-[13px]">Bank, Venmo, cash. Use − if you owe.</p>
      </div>

      <div className="space-y-2.5">
        <Label>Budget lines</Label>
        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input
                value={l.name}
                onChange={(e) => set(i, { name: e.target.value })}
                placeholder="Food"
                aria-label={`Budget line ${i + 1} name`}
                className="min-w-0 flex-1"
              />
              <div className="relative w-32 shrink-0">
                <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) => set(i, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && i === lines.length - 1) {
                      e.preventDefault();
                      setLines((ls) => [...ls, { id: null, name: "", amount: "" }]);
                    }
                  }}
                  placeholder="0"
                  aria-label={`Budget line ${i + 1} amount`}
                  className="ps-7 tabular-nums"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${l.name || `line ${i + 1}`}`}
                onClick={() =>
                  setLines((ls) =>
                    ls.length === 1
                      ? [{ id: null, name: "", amount: "" }]
                      : ls.filter((_, j) => j !== i),
                  )
                }
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { id: null, name: "", amount: "" }])}
          >
            <Plus aria-hidden="true" />
            Add a line
          </Button>
          {suggestions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => addSuggestion(n)}
              className={cn(chipClass(false), "gap-1")}
            >
              <Plus className="size-3" aria-hidden="true" />
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save
        </Button>
        {error && (
          <p role="alert" className="text-tint-danger-foreground text-sm">
            {error}
          </p>
        )}
        <span className="flex-1" />
        <Link href={`${base}/import`} className="text-sm underline underline-offset-4">
          Import past records
        </Link>
        {state.treasurerCount === 0 && (
          <Link
            href={`/app/${orgSlug}/settings/members#roster`}
            className="text-sm underline underline-offset-4"
          >
            Choose a treasurer
          </Link>
        )}
      </div>
    </div>
  );
}
