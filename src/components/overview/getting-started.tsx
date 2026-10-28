"use client";

import { ArrowUpRight, Check, Loader2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { setStartedStepSkipped } from "@/app/app/[orgSlug]/getting-started-actions";
import { Gauge } from "@/components/ui/meters";
import {
  startedProgress,
  type StartedState,
  type StartedStepKey,
} from "@/lib/overview/getting-started";
import { cn } from "@/lib/utils";

/**
 * "Get your club started" on the Overview (owners and admins): a Progress
 * block across the page under Up next, with a gauge and every step as a
 * tile. A step is done when the club has the thing; "Not needed" checks it
 * off (and Undo puts it back). The page leaves the card out once every step
 * is one or the other. It sits still: no tilt, only the tiles light up.
 */
export function GettingStarted({
  orgId,
  orgSlug,
  state,
  skipped,
}: {
  orgId: string;
  orgSlug: string;
  state: StartedState;
  skipped: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<StartedStepKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownSkipped, setShownSkipped] = useOptimistic(
    skipped,
    (current: string[], change: { step: string; skip: boolean }) =>
      change.skip ? [...current, change.step] : current.filter((s) => s !== change.step),
  );
  const progress = startedProgress(state, shownSkipped);
  const left = progress.total - progress.finished;

  function toggle(step: StartedStepKey, skip: boolean) {
    setError(null);
    setBusy(step);
    start(async () => {
      setShownSkipped({ step, skip });
      const result = await setStartedStepSkipped(orgId, step, skip);
      setBusy(null);
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="started-heading"
      className="bg-block-goal text-block-goal-foreground rounded-block relative isolate overflow-hidden p-6 sm:p-8"
    >
      {/* A soft top light, as on every block. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-white/7 to-transparent to-45%"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="max-w-[560px] min-w-0">
          <h2
            id="started-heading"
            className="display-title m-0 text-[clamp(1.625rem,1.2rem+1.4vw,2.125rem)]"
          >
            Get your organization started
          </h2>
          <p className="mt-2 text-[15px] leading-[1.5] text-(--block-goal-meta)">
            {left === 1
              ? "One step left before your organization is ready for members."
              : `${left} steps left before your organization is ready for members. Check off anything you don't need.`}
          </p>
        </div>
        <Gauge
          value={(progress.finished / progress.total) * 100}
          caption={`${progress.finished} of ${progress.total}`}
          size={112}
        />
      </div>

      <ul className="mt-6 grid list-none gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {progress.steps.map((step) => {
          const href = `/app/${orgSlug}${step.path}`;
          const working = pending && busy === step.key;
          return (
            <li
              key={step.key}
              className={cn(
                "rounded-tile group/step relative flex items-start gap-3 p-4 transition-colors",
                step.status === "todo"
                  ? "bg-[color-mix(in_oklab,currentColor_9%,transparent)] hover:bg-[color-mix(in_oklab,currentColor_14%,transparent)]"
                  : "bg-[color-mix(in_oklab,currentColor_4%,transparent)]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-6 flex-none place-items-center rounded-full border-[1.5px] border-current",
                  step.status === "done" && "bg-current",
                  step.status === "skipped" && "border-dashed opacity-70",
                )}
              >
                {step.status === "done" && (
                  <Check className="text-block-goal size-3.5" strokeWidth={3} />
                )}
                {step.status === "skipped" && <Check className="size-3.5" strokeWidth={2.5} />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={href}
                  className={cn(
                    "text-[15px] leading-[1.3] font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:outline-current",
                    step.status !== "todo" && "line-through decoration-1 opacity-70",
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {step.status === "done"
                      ? " (done)"
                      : step.status === "skipped"
                        ? " (not needed)"
                        : " (to do)"}
                  </span>
                </Link>
                <span className="text-[13px] leading-[1.4] text-(--block-goal-meta)">
                  {step.status === "skipped"
                    ? "Checked off as not needed."
                    : step.recommended && step.status === "todo"
                      ? `Recommended. ${step.hint}`
                      : step.hint}
                </span>
              </span>
              {step.status === "todo" ? (
                <span className="relative z-10 flex flex-none items-center gap-1">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => toggle(step.key, true)}
                    className="h-7 cursor-pointer rounded-full px-2.5 text-[12px] font-semibold ring-1 ring-current/25 transition-colors hover:ring-current/60 disabled:opacity-60"
                  >
                    {working ? (
                      <Loader2 className="size-3.5 animate-spin" aria-label="Saving" />
                    ) : (
                      "Not needed"
                    )}
                  </button>
                  <ArrowUpRight className="size-4 opacity-60" aria-hidden="true" />
                </span>
              ) : step.status === "skipped" ? (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => toggle(step.key, false)}
                  className="relative z-10 h-7 flex-none cursor-pointer rounded-full px-2.5 text-[12px] font-semibold underline-offset-4 hover:underline disabled:opacity-60"
                >
                  Undo
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-[14px] font-semibold">
          {error}
        </p>
      )}
    </section>
  );
}
