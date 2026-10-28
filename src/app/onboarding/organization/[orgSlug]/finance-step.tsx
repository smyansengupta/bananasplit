"use client";

import { Check } from "@/components/icons";
import { useMemo, useState, useTransition } from "react";

import { brandInputClass } from "@/components/brand/fields";
import {
  ContinuePill,
  PreviewHeader,
  PreviewTile,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
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

/** Bar heights for the preview's empty chart, as in the home page's widget. */
const BARS = [82, 64, 90, 38, 56, 44] as const;

/**
 * B4 · Finance: which reports the finance board shows, and the fiscal year,
 * which can start the first budget period.
 */
export function FinanceStep({
  orgId,
  orgSlug,
  index,
  total,
  backHref,
  state,
  timezone,
}: {
  orgId: string;
  orgSlug: string;
  index: number;
  total: number;
  backHref: string;
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

  const shown = FINANCE_CARDS.filter((c) => cards.includes(c.id));

  return (
    <SetupCard
      preview={
        <>
          <PreviewHeader meta="Finance board" />
          <PreviewTile className="gap-4">
            <div className="flex items-start justify-between gap-3">
              <span className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[13px]">Left this term</span>
                <span className="font-heading text-[36px] leading-none tracking-[-0.03em] tabular-nums">
                  $0
                </span>
              </span>
              <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-bold">
                {fy.label}
              </span>
            </div>
            <div className="flex h-16 items-end gap-2" aria-hidden="true">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  className={cn("flex-1 rounded-md", i === 4 ? "bg-brand-accent" : "bg-muted")}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </PreviewTile>
          {shown.map((card) => (
            <PreviewTile key={card.id} className="gap-1">
              <span className="text-[14px] font-semibold">{card.title}</span>
              <span className="text-muted-foreground text-[12px] leading-normal">
                {card.detail}
              </span>
            </PreviewTile>
          ))}
          {shown.length === 0 && (
            <p className="text-muted-foreground m-0 text-[12px]">
              Pick at least one report for the board.
            </p>
          )}
        </>
      }
    >
      <StepIntro index={index} total={total} title="What should the treasurer see?">
        Pick the reports on your finance board, and when your organization&apos;s year starts.
      </StepIntro>

      <StepBody className="gap-5">
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="group"
          aria-label="Reports on the finance board"
        >
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
                  "bg-card rounded-field flex cursor-pointer items-start gap-3 border px-4 py-3 text-left transition-colors",
                  on ? "border-foreground" : "border-foreground/10 hover:border-foreground/25",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{card.title}</span>
                  <span className="text-muted-foreground text-[13px] leading-snug">
                    {card.detail}
                  </span>
                </span>
                <span
                  className={cn(
                    "mt-0.5 grid size-5 flex-none place-items-center rounded-full border-[1.5px]",
                    on
                      ? "bg-primary border-foreground text-primary-foreground"
                      : "border-foreground/22",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="fy-start" className="text-[14px] font-semibold">
            Your year starts
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              id="fy-start"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className={cn(brandInputClass, "h-11 w-auto cursor-pointer pr-3")}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m} 1
                </option>
              ))}
            </select>
            <span className="bg-muted rounded-full px-3 py-1.5 text-[13px] font-semibold">
              {fy.label}
              <span className="text-muted-foreground font-normal">
                {" "}
                · {formatDay(fy.startsOn)} – {formatDay(fy.endsOn)}
              </span>
            </span>
          </div>
        </div>

        {state.activePeriod ? (
          <p className="text-muted-foreground m-0 text-[13px]">
            Budget period in use: {state.activePeriod.label}. Change it on the Budget page.
          </p>
        ) : state.canManageFinance ? (
          <label className="bg-muted flex cursor-pointer items-start gap-3 rounded-[14px] px-4 py-3">
            <Checkbox
              checked={createPeriod}
              onCheckedChange={(v) => setCreatePeriod(v === true)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-semibold">Start the {fy.label} budget now</span>
              <span className="text-muted-foreground text-[13px]">
                With the usual categories at $0. The treasurer sets the amounts on the Budget page.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-muted-foreground m-0 text-[13px]">
            The owner or treasurer starts the budget period.
          </p>
        )}
      </StepBody>

      <StepError message={error} />
      <StepFooter
        back={{ href: backHref }}
        skip={{
          onClick: () => start(() => goToNextOrgStep(orgSlug, "finance")),
          disabled: pending,
        }}
      >
        <ContinuePill pending={pending} onClick={submit} disabled={cards.length === 0} />
      </StepFooter>
    </SetupCard>
  );
}
