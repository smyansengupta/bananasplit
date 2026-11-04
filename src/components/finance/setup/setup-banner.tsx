"use client";

import { ArrowRight, ListChecks, X } from "@/components/icons";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/stat";
import type { FinanceSetupState } from "@/lib/finance/setup";
import { cn } from "@/lib/utils";

/**
 * The dashboard's nudge until the budget basics are in place: how far setup
 * is the one way into it (setup is one screen). "Hide" is remembered in
 * this browser only (a convenience; setup stays at Finance › Set up).
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
  const fresh = state.period === null;
  if ((storedHidden || hiddenNow) && !fresh) return null;

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
              {fresh ? "Set up finance" : "Finish setting up finance"}
            </h2>
            <p className="text-muted-foreground text-sm">What you have and your budget.</p>
          </div>
        </div>
      </div>
      <div className={cn("flex items-center gap-2", !fresh && "sm:pr-8")}>
        <Button asChild>
          <Link href={`/app/${orgSlug}/finance/setup`}>
            {fresh ? "Set up" : "Continue"}
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
