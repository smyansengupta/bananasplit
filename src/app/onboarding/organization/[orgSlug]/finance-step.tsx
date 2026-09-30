"use client";

import { Check } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { FieldError } from "@/components/onboarding/step-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FINANCE_CARDS } from "@/lib/finance/dashboard-cards";
import { fiscalYearFor, MONTHS } from "@/lib/onboarding/org";
import { cn } from "@/lib/utils";
import type { FinanceSetupState } from "@/server/onboarding/org-setup";

import { goToNextOrgStep, saveFinanceStepAction } from "./actions";

function todayIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * B4 · Finance reports: which sections the finance dashboard shows, and
 * the fiscal year, which creates the first budget period.
 */
export function FinanceStep({
  orgId,
  orgSlug,
  state,
  timezone,
}: {
  orgId: string;
  orgSlug: string;
  state: FinanceSetupState;
  timezone: string;
}) {
  const [cards, setCards] = useState<string[]>(state.cards);
  const [month, setMonth] = useState(8);
  const [createPeriod, setCreatePeriod] = useState(!state.activePeriod && state.canManageFinance);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fy = useMemo(() => fiscalYearFor(todayIn(timezone), month), [timezone, month]);

  function toggle(id: string) {
    setCards(cards.includes(id) ? cards.filter((c) => c !== id) : [...cards, id]);
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveFinanceStepAction(orgId, {
        cards,
        fiscalYearStartMonth: month,
        createPeriod,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await goToNextOrgStep(orgSlug, "finance");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2" role="group" aria-label="Reports on the finance dashboard">
        {FINANCE_CARDS.map((card) => {
          const on = cards.includes(card.id);
          return (
            <button
              key={card.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(card.id)}
              className={cn(
                "focus-visible:ring-ring/50 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-3",
                on ? "border-warning/40 bg-warning/5" : "hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded",
                  on ? "bg-warning text-warning-foreground" : "border",
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{card.title}</span>
                <span className="text-muted-foreground block text-[11px]">{card.detail}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Fiscal year starts</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m} 1
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">This year</span>
          <div className="bg-muted/40 flex h-9 items-center rounded-md border px-3 text-xs">
            {fy.label}: {formatDay(fy.startsOn)} – {formatDay(fy.endsOn)}
          </div>
        </div>
      </div>

      {state.activePeriod ? (
        <p className="text-muted-foreground text-xs">
          Budget period in use: {state.activePeriod.label}. Change it on the Budget page.
        </p>
      ) : state.canManageFinance ? (
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={createPeriod}
            onCheckedChange={(v) => setCreatePeriod(v === true)}
            className="mt-0.5"
          />
          <span>
            Start the {fy.label} budget now, with the usual categories at $0. The treasurer sets the
            amounts on the Budget page.
          </span>
        </label>
      ) : (
        <p className="text-muted-foreground text-xs">
          The owner or treasurer starts the budget period.
        </p>
      )}

      <FieldError message={error ?? undefined} />
      <Button
        type="button"
        className="w-full font-semibold"
        onClick={submit}
        disabled={pending || cards.length === 0}
      >
        {pending ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
