"use client";

import { ArrowRight, Loader2, PiggyBank } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createBudgetPeriod } from "@/app/app/[orgSlug]/finance/periods-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { formatPeriodRange, PERIOD_PRESETS, type PeriodPresetId } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";

/**
 * Shown on Finance until the club has a budget period: pick school year,
 * semester or calendar year and go. Nothing else on the page waits for it;
 * the first transaction sets up the school year on its own.
 */
export function BudgetSetupCard({
  orgId,
  orgSlug,
  today,
}: {
  orgId: string;
  orgSlug: string;
  /** The club's local date (YYYY-MM-DD), so server and browser agree on the year. */
  today: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<PeriodPresetId>("school-year");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const base = new Date(`${today}T12:00:00`);
  const presets = PERIOD_PRESETS.map((p) => ({ ...p, draft: p.make(base) }));
  const picked = presets.find((p) => p.id === choice) ?? presets[0];

  function begin() {
    setError(null);
    start(async () => {
      const result = await createBudgetPeriod(orgId, picked.draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({
        title: `Budget for ${picked.draft.label} is ready`,
        description: "Set how much each category may spend under Budget.",
        tone: "success",
      });
      router.refresh();
    });
  }

  return (
    <section className="bg-primary/5 border-primary/20 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
          <PiggyBank className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-semibold">Set up your budget</h2>
          <p className="text-muted-foreground text-sm">
            Pick the stretch of time it covers. It starts with a few everyday categories (Food, Supplies,
            Events…) you can rename or change. You can also just add a transaction: this school year is set
            up for you.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Budget period">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={choice === p.id}
            onClick={() => setChoice(p.id)}
            className={cn(
              "bg-background rounded-lg border px-3 py-2.5 text-left transition-colors",
              choice === p.id ? "border-primary ring-primary/20 ring-2" : "hover:border-foreground/20",
            )}
          >
            <span className="block text-sm font-medium">
              {p.name} · {p.draft.label}
            </span>
            <span className="text-muted-foreground block text-xs">
              {formatPeriodRange(p.draft.startsOn, p.draft.endsOn)}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={begin} disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4" aria-hidden="true" />
          )}
          Start tracking {picked.draft.label}
        </Button>
        <Link
          href={`/app/${orgSlug}/finance/budget`}
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
        >
          Use other dates
        </Link>
        {error && (
          <p role="alert" className="text-destructive w-full text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
