import { AlertTriangle, ArrowRight, Check } from "@/components/icons";
import Link from "next/link";

import { ProgressBar, StatusWord, StepMarker } from "@/components/setup/setup-ui";
import { cn } from "@/lib/utils";
import type { SetupStepId } from "@/server/setup/catalog";
import { setupStep } from "@/server/setup/catalog";
import type { SetupStepStatus } from "@/server/setup/progress";

import type { SetupStepView } from "./view";

/**
 * The rail: every step, its state, and which one is open. It is the
 * progress indicator and the navigation at once, so nobody has to guess how
 * much is left or how to get back to something they skipped.
 *
 * Each step is a link, not a wizard gate: an org that only wants the
 * Claude key can go straight there. Server-rendered — the active step is
 * ?step=, so it survives a refresh, a bookmark and the back button.
 *
 * On a wide screen it is a vertical spine of filled circles (the goal colour
 * with a check once a step works) joined by a line; on a phone the same list
 * is a row of step pills that scrolls sideways.
 */

/** Phone pill colours: done in the goal colour, the open step primary, the rest muted. */
function pillTone(status: SetupStepStatus, active: boolean): string {
  if (active) return "max-lg:bg-primary max-lg:text-primary-foreground";
  if (status === "connected") return "max-lg:bg-block-goal max-lg:text-block-goal-foreground";
  if (status === "error" || status === "needs_reauth")
    return "max-lg:bg-tint-danger max-lg:text-tint-danger-foreground";
  return "max-lg:bg-muted max-lg:text-muted-foreground max-lg:hover:bg-muted-strong";
}

const linkBase = cn(
  "focus-glow flex items-center gap-1.5 whitespace-nowrap transition-colors",
  // Phone: a 32px step pill.
  "max-lg:h-8 max-lg:rounded-full max-lg:px-3.5 max-lg:text-[13px] max-lg:font-semibold",
  // Wide: a row with the circle beside the title and its state.
  "lg:items-start lg:gap-3 lg:rounded-tile lg:p-2.5 lg:whitespace-normal",
);

/** The line from one circle down to the next (wide screens only). */
const spineLine =
  "relative shrink-0 lg:not-last:before:absolute lg:not-last:before:top-[42px] lg:not-last:before:-bottom-[10px] lg:not-last:before:left-[23px] lg:not-last:before:w-0.5 lg:not-last:before:rounded-full lg:not-last:before:bg-border";

export function SetupSpine({
  orgSlug,
  steps,
  active,
  finishActive,
  progress,
}: {
  orgSlug: string;
  steps: SetupStepView[];
  active: SetupStepId | null;
  finishActive: boolean;
  /** The fraction connected, shown above the spine on a wide screen. */
  progress?: { done: number; total: number; label: string };
}) {
  const base = `/app/${orgSlug}/setup`;
  return (
    // min-w-0: without it a grid item takes its content's width, and the
    // rail's own horizontal scroller would widen the whole page on a phone.
    <nav aria-label="Setup steps" className="min-w-0 space-y-5 lg:sticky lg:top-6">
      {progress ? (
        <ProgressBar
          done={progress.done}
          total={progress.total}
          label={progress.label}
          className="px-2.5 max-lg:hidden"
        />
      ) : null}
      <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {steps.map((view, i) => {
          const step = setupStep(view.id);
          const isActive = active === view.id;
          const broken = view.status === "error" || view.status === "needs_reauth";
          return (
            <li key={view.id} className={spineLine}>
              <Link
                href={`${base}?step=${view.id}`}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  linkBase,
                  pillTone(view.status, isActive),
                  isActive ? "lg:bg-muted/60" : "lg:hover:bg-muted/40",
                )}
              >
                <StepMarker
                  status={view.status}
                  ordinal={i + 1}
                  active={isActive}
                  className="max-lg:hidden"
                />
                {view.status === "connected" ? (
                  <Check className="size-3.5 lg:hidden" strokeWidth={2.75} aria-hidden="true" />
                ) : broken ? (
                  <AlertTriangle className="size-3.5 lg:hidden" aria-hidden="true" />
                ) : null}
                <span className="lg:min-w-0 lg:flex-1 lg:pt-px">
                  <span
                    className={cn(
                      "block lg:text-sm lg:leading-snug",
                      isActive ? "lg:font-semibold" : "lg:font-medium",
                    )}
                  >
                    {step.title}
                  </span>
                  <StatusWord status={view.status} className="block max-lg:sr-only" />
                </span>
              </Link>
            </li>
          );
        })}
        <li className={spineLine}>
          <Link
            href={`${base}?step=finish`}
            aria-current={finishActive ? "step" : undefined}
            className={cn(
              linkBase,
              "lg:items-center",
              finishActive
                ? "max-lg:bg-primary max-lg:text-primary-foreground lg:bg-muted/60"
                : "max-lg:bg-muted max-lg:text-muted-foreground max-lg:hover:bg-muted-strong lg:hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full max-lg:hidden",
                finishActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
            <span
              className={cn("lg:text-sm", finishActive ? "lg:font-semibold" : "lg:font-medium")}
            >
              Finish
            </span>
          </Link>
        </li>
      </ol>
    </nav>
  );
}
