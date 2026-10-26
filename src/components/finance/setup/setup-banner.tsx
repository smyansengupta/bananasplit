"use client";

import { ArrowRight, Check, ListChecks, X } from "@/components/icons";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/stat";
import { SETUP_STEPS, setupProgress, stepDone, type FinanceSetupState } from "@/lib/finance/setup";
import { cn } from "@/lib/utils";

/**
 * The dashboard's nudge until the budget basics are in place: how far setup
 * is, and the way back into it. A calm card: the steps as a row, done ones
 * with a filled circle. "Hide" is remembered in this browser only (a
 * convenience; the setup guide stays under Finance › Set up).
 */

const noSubscribe = () => () => undefined;

function readHidden(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function FinanceSetupBanner({
  orgId,
  orgSlug,
  state,
}: {
  orgId: string;
  orgSlug: string;
  state: FinanceSetupState;
}) {
  const key = `bananasplit:finance-setup-hidden:${orgId}`;
  const storedHidden = useSyncExternalStore(
    noSubscribe,
    () => readHidden(key),
    () => false,
  );
  const [hiddenNow, setHiddenNow] = useState(false);
  const { done, total, next } = setupProgress(state);
  const fresh = state.period === null;
  if ((storedHidden || hiddenNow) && !fresh) return null;
  const nextStep = SETUP_STEPS.find((s) => s.id === next);

  return (
    <Card
      role="region"
      aria-labelledby="finance-setup-banner-title"
      className="relative gap-4 px-6 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <div className={cn("flex min-w-0 flex-1 items-start gap-3.5", !fresh && "max-sm:pr-8")}>
        <IconChip icon={ListChecks} size="md" />
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h2 id="finance-setup-banner-title" className="heading text-[17px]">
              {fresh ? "Set up your club's finances" : "Finish setting up finance"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {fresh
                ? "Pick your budget year, enter what the club has, set a budget, and bring in last year's spreadsheet. About five minutes."
                : `${done} of ${total} steps done.${nextStep ? ` Next: ${nextStep.title.toLowerCase()}.` : ""}`}
            </p>
          </div>
          <ol className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]" aria-label="Setup steps">
            {SETUP_STEPS.map((s) => {
              const ok = stepDone(state, s.id);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-1.5 font-medium",
                    ok ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {/* Filled circle: done; a ring: still to do. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full",
                      ok
                        ? "bg-block-goal text-block-goal-foreground"
                        : "border-muted-foreground/45 border-[1.5px]",
                    )}
                  >
                    {ok && <Check className="size-2.5 stroke-[3]" />}
                  </span>
                  {s.short}
                  <span className="sr-only">{ok ? " (done)" : " (to do)"}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className={cn("flex items-center gap-2", !fresh && "sm:pr-8")}>
        <Button asChild>
          <Link href={`/app/${orgSlug}/finance/setup`}>
            {fresh ? "Start setup" : "Continue setup"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {!fresh && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground absolute top-3 right-3"
          aria-label="Hide the setup reminder"
          onClick={() => {
            try {
              window.localStorage.setItem(key, "1");
            } catch {
              // Private windows may refuse storage: it just hides until the next visit.
            }
            setHiddenNow(true);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </Card>
  );
}
