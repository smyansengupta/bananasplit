"use client";

import {
  CalendarRange,
  ChartColumn,
  ChartPie,
  Check,
  CircleCheck,
  Handshake,
  Hourglass,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { ContinueButton, FieldError } from "@/components/onboarding/step-card";
import { Checkbox } from "@/components/ui/checkbox";
import { FINANCE_CARDS } from "@/lib/finance/dashboard-cards";
import { fiscalYearFor, MONTHS } from "@/lib/onboarding/org";
import { cn } from "@/lib/utils";
import type { FinanceSetupState } from "@/server/onboarding/org-setup";

import { goToNextOrgStep, saveFinanceStepAction } from "./actions";

const CARD_ICONS: Record<string, LucideIcon> = {
  categories: ChartPie,
  runway: Hourglass,
  sponsorships: Handshake,
  burn: ChartColumn,
};

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
    <div className="space-y-5">
      <div className="space-y-2">
        <span className="text-sm font-medium">On the finance dashboard</span>
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Reports on the finance dashboard">
          {FINANCE_CARDS.map((card) => {
            const on = cards.includes(card.id);
            const Icon = CARD_ICONS[card.id];
            return (
              <button
                key={card.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(card.id)}
                className={cn(
                  "focus-visible:ring-ring/50 relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-3 active:scale-[0.99]",
                  on ? "border-warning/50 bg-warning/5" : "hover:border-foreground/25",
                )}
              >
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0 transition-colors", on ? "text-warning" : "text-muted-foreground")}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 pr-5">
                  <span className="block text-sm font-medium">{card.title}</span>
                  <span className="text-muted-foreground block text-xs leading-snug">{card.detail}</span>
                </span>
                <span
                  className={cn(
                    "absolute top-3 right-3 grid size-4 place-items-center rounded-full border transition-colors",
                    on && "border-warning bg-warning text-warning-foreground",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarRange className="text-muted-foreground size-3.5" aria-hidden="true" />
          Fiscal year
        </span>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Starts</span>
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
          <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium">
            {fy.label}
            <span className="text-muted-foreground font-normal">
              {formatDay(fy.startsOn)} – {formatDay(fy.endsOn)}
            </span>
          </span>
        </div>

        {state.activePeriod ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CircleCheck className="text-success size-3.5" aria-hidden="true" />
            Budget period in use: {state.activePeriod.label}. Change it on the Budget page.
          </p>
        ) : state.canManageFinance ? (
          <label className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors">
            <Checkbox
              checked={createPeriod}
              onCheckedChange={(v) => setCreatePeriod(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Wallet className="text-muted-foreground size-3.5" aria-hidden="true" />
                Start the {fy.label} budget now
              </span>
              <span className="text-muted-foreground block text-xs">
                With the usual categories at $0. The treasurer sets the amounts on the Budget page.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-muted-foreground text-xs">The owner or treasurer starts the budget period.</p>
        )}
      </div>

      <FieldError message={error ?? undefined} />
      <div className="flex border-t pt-4">
        <ContinueButton pending={pending} onClick={submit} disabled={cards.length === 0} />
      </div>
    </div>
  );
}
