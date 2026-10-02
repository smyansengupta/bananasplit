"use client";

import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { SETUP_STEPS, setupProgress, stepDone, type FinanceSetupState } from "@/lib/finance/setup";
import { cn } from "@/lib/utils";

/**
 * The dashboard's nudge until the budget basics are in place: how far setup
 * is, and the way back into it. "Hide" is remembered in this browser only
 * (a convenience; the setup guide stays under Finance › Set up).
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
  const storedHidden = useSyncExternalStore(noSubscribe, () => readHidden(key), () => false);
  const [hiddenNow, setHiddenNow] = useState(false);
  const { done, total, next } = setupProgress(state);
  const fresh = state.period === null;
  if ((storedHidden || hiddenNow) && !fresh) return null;
  const nextStep = SETUP_STEPS.find((s) => s.id === next);

  return (
    <section className="bg-card rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="heading">{fresh ? "Set up your club's finances" : "Finish setting up finance"}</h2>
            <p className="text-muted-foreground text-sm">
              {fresh
                ? "Pick your budget year, enter what the club has, set a budget, and bring in last year's spreadsheet. About five minutes."
                : `${done} of ${total} steps done.${nextStep ? ` Next: ${nextStep.title.toLowerCase()}.` : ""}`}
            </p>
          </div>
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Setup steps">
            {SETUP_STEPS.map((s) => {
              const ok = stepDone(state, s.id);
              return (
                <li
                  key={s.id}
                  className={cn("flex items-center gap-1", ok ? "text-success" : "text-muted-foreground")}
                >
                  {ok && <Check className="size-3" aria-hidden="true" />}
                  {s.short}
                  <span className="sr-only">{ok ? " (done)" : " (to do)"}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="flex items-center gap-2 self-center">
          <Button asChild>
            <Link href={`/app/${orgSlug}/finance/setup`}>
              {fresh ? "Start setup" : "Continue setup"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          {!fresh && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
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
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
