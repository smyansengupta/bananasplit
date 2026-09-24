import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { StatusWord, StepMarker } from "@/components/setup/setup-ui";
import { cn } from "@/lib/utils";
import type { SetupStepId } from "@/server/setup/catalog";
import { setupStep } from "@/server/setup/catalog";

import type { SetupStepView } from "./view";

/**
 * The rail: every step, its state, and which one is open. It is the
 * progress indicator and the navigation at once, so nobody has to guess how
 * much is left or how to get back to something they skipped.
 *
 * Each step is a link, not a wizard gate: an org that only wants the
 * Claude key can go straight there. Server-rendered — the active step is
 * ?step=, so it survives a refresh, a bookmark and the back button.
 */
export function SetupSpine({
  orgSlug,
  steps,
  active,
  finishActive,
}: {
  orgSlug: string;
  steps: SetupStepView[];
  active: SetupStepId | null;
  finishActive: boolean;
}) {
  const base = `/app/${orgSlug}/setup`;
  return (
    <nav aria-label="Setup steps" className="lg:sticky lg:top-6">
      <ol className="flex gap-2 overflow-x-auto pb-2 lg:block lg:overflow-visible lg:pb-0">
        {steps.map((view, i) => {
          const step = setupStep(view.id);
          const isActive = active === view.id;
          return (
            <li key={view.id} className="min-w-[11rem] shrink-0 lg:min-w-0">
              <Link
                href={`${base}?step=${view.id}`}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "focus-visible:ring-ring flex items-start gap-2.5 rounded-lg p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  isActive ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <StepMarker status={view.status} ordinal={i + 1} active={isActive} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm leading-snug",
                      isActive ? "font-medium" : "font-normal",
                    )}
                  >
                    {step.title}
                  </span>
                  <StatusWord status={view.status} className="block" />
                </span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-[11rem] shrink-0 lg:min-w-0">
          <Link
            href={`${base}?step=finish`}
            aria-current={finishActive ? "step" : undefined}
            className={cn(
              "focus-visible:ring-ring flex items-center gap-2.5 rounded-lg p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
              finishActive ? "bg-muted" : "hover:bg-muted/50",
            )}
          >
            <span className="text-muted-foreground grid size-6 shrink-0 place-items-center">
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
            <span className={cn("text-sm", finishActive ? "font-medium" : "font-normal")}>
              Finish
            </span>
          </Link>
        </li>
      </ol>
    </nav>
  );
}
