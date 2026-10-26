import { Check } from "@/components/icons";

import { cn } from "@/lib/utils";

/**
 * The steps of an import as a row of pills (Moonstone): done steps in the
 * goal colour with a check, the current one in the primary, the rest muted.
 * `current` is the index of the step in progress; past it everything is
 * upcoming, before it done (`current = steps.length` marks them all done).
 */
export function StepPills({
  steps,
  current,
  label = "Steps",
  className,
}: {
  steps: readonly string[];
  current: number;
  label?: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {steps.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
              state === "done" && "bg-block-goal text-block-goal-foreground",
              state === "current" && "bg-primary text-primary-foreground",
              state === "upcoming" && "bg-muted text-muted-foreground",
            )}
          >
            {state === "done" ? (
              <Check className="size-3.5 stroke-[2.5]" aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="tabular-nums">
                {i + 1}
              </span>
            )}
            {step}
            {state === "done" && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}
