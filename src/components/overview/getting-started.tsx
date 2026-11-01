"use client";

import {
  ArrowUpRight,
  CalendarPlus,
  Check,
  CheckSquare,
  Copy,
  Database,
  ImagePlus,
  Loader2,
  Network,
  PiggyBank,
  Tags,
  UserPlus,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import {
  hideGettingStarted,
  restoreStartedSkipped,
  setStartedStepSkipped,
} from "@/app/app/[orgSlug]/getting-started-actions";
import { Gauge } from "@/components/ui/meters";
import { toast } from "@/components/ui/toaster";
import {
  STARTED_EXTRAS,
  startedHref,
  startedProgress,
  type StartedState,
  type StartedStepKey,
} from "@/lib/overview/getting-started";
import { cn } from "@/lib/utils";

/**
 * "Get your organization started" on the Overview (owners and admins): a
 * Progress block across the page under Up next. On the left, the gauge and
 * a rail of one segment per step (solid when done, dashed when not
 * needed). On the right, only what's left, each step a tile with its own
 * icon; what's finished folds into a row of small checked chips under
 * them, each with Undo when it was only checked off. A step is done when
 * the organization has the thing; "Not needed" checks it off, and Hide
 * checks off the rest at once, with Undo in the toast. The page leaves the
 * card out once every step is one or the other. Inviting copies the join
 * link right on its tile. Setup that never "finishes" (importing, tags,
 * emails, tools) is a row of pills along the bottom.
 */

const STEP_ICON: Record<StartedStepKey, IconComponent> = {
  picture: ImagePlus,
  members: UserPlus,
  event: CalendarPlus,
  types: Tags,
  task: CheckSquare,
  teams: Network,
  budget: PiggyBank,
  database: Database,
};
export function GettingStarted({
  orgId,
  orgSlug,
  state,
  skipped,
  joinLink,
}: {
  orgId: string;
  orgSlug: string;
  state: StartedState;
  skipped: string[];
  /** The club's join link, when the viewer may share it: copied from the invite tile. */
  joinLink?: string | null;
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
  const [copied, setCopied] = useState(false);

  function hideAll() {
    setError(null);
    start(async () => {
      const result = await hideGettingStarted(orgId);
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      const previous = result.previous ?? [];
      toast({
        title: "Hidden",
        action: {
          label: "Undo",
          run: async () => {
            const undone = await restoreStartedSkipped(orgId, previous);
            if (!undone.ok) return undone.error ?? "That didn't work. Try again.";
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  }

  async function copyLink() {
    if (!joinLink) return;
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't copy. Open Members to copy the link.");
    }
  }

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

  const todo = progress.steps.filter((step) => step.status === "todo");
  const finished = progress.steps.filter((step) => step.status !== "todo");
  const left = progress.total - progress.finished;

  return (
    <section
      aria-labelledby="started-heading"
      className="bg-block-goal text-block-goal-foreground rounded-block relative isolate overflow-hidden p-6 sm:p-8"
    >
      {/* A soft top light, as on every block, and a wide glow behind the gauge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-white/7 to-transparent to-45%"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 -z-10 size-80 rounded-full bg-white/6 blur-3xl"
      />
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div>
            <div className="min-w-0">
              <h2
                id="started-heading"
                className="display-title m-0 text-[clamp(1.5rem,1.15rem+1.2vw,2rem)] leading-[1.1]"
              >
                Get your organization started
              </h2>
              <p className="mt-2 text-[14px] text-(--block-goal-meta)">
                {left === 1 ? "One step left." : `${left} steps left.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Gauge
              value={(progress.finished / progress.total) * 100}
              caption={`${progress.finished} of ${progress.total}`}
              size={124}
            />
            <ol
              aria-label={`${progress.finished} of ${progress.total} steps finished`}
              className="grid min-w-0 flex-1 grid-cols-4 gap-1.5"
            >
              {progress.steps.map((step) => {
                const Icon = STEP_ICON[step.key];
                return (
                  <li
                    key={step.key}
                    title={step.label}
                    className={cn(
                      "grid aspect-square place-items-center rounded-[10px] transition-colors",
                      step.status === "done" && "text-block-goal bg-white",
                      step.status === "skipped" && "border-[1.5px] border-dashed border-current/45",
                      step.status === "todo" && "bg-current/12",
                    )}
                  >
                    <Icon
                      className={cn("size-4", step.status === "skipped" && "opacity-60")}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {step.label}
                      {step.status === "done"
                        ? " (done)"
                        : step.status === "skipped"
                          ? " (not needed)"
                          : " (to do)"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <ul className="grid list-none gap-2.5 p-0 sm:grid-cols-2">
            {todo.map((step) => {
              const href = startedHref(orgSlug, step.path);
              const Icon = STEP_ICON[step.key];
              const copyHere = step.key === "members" && joinLink;
              const working = pending && busy === step.key;
              return (
                <li
                  key={step.key}
                  className="rounded-tile group/step relative flex flex-col gap-3 bg-[color-mix(in_oklab,currentColor_10%,transparent)] p-4 transition-colors hover:bg-[color-mix(in_oklab,currentColor_15%,transparent)]"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="text-block-goal grid size-10 flex-none place-items-center rounded-[12px] bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)]"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        href={href}
                        className="text-[15px] leading-[1.3] font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:outline-current"
                      >
                        {step.label}
                      </Link>
                      <span className="text-[13px] leading-[1.4] text-(--block-goal-meta)">
                        {step.hint}
                      </span>
                    </span>
                    <ArrowUpRight
                      className="size-4 flex-none opacity-60 transition-transform group-hover/step:translate-x-0.5 group-hover/step:-translate-y-0.5"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="relative z-10 flex flex-wrap items-center gap-1.5 pl-[3.25rem]">
                    {copyHere && (
                      <button
                        type="button"
                        onClick={copyLink}
                        className="text-block-goal inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-white px-2.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
                      >
                        {copied ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                        {copied ? "Copied" : "Copy invite link"}
                      </button>
                    )}
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
                  </div>
                </li>
              );
            })}
          </ul>

          {finished.length > 0 && (
            <ul className="flex list-none flex-wrap gap-1.5 p-0" aria-label="Finished">
              {finished.map((step) => {
                const working = pending && busy === step.key;
                return (
                  <li
                    key={step.key}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-[12.5px] font-medium",
                      step.status === "done"
                        ? "bg-current/10"
                        : "border border-dashed border-current/35 pr-1.5",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-5 place-items-center rounded-full",
                        step.status === "done" ? "text-block-goal bg-white" : "bg-current/15",
                      )}
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <Link
                      href={startedHref(orgSlug, step.path)}
                      className="underline-offset-4 hover:underline"
                    >
                      {step.label}
                    </Link>
                    <span className="sr-only">
                      {step.status === "done" ? " (done)" : " (not needed)"}
                    </span>
                    {step.status === "skipped" && (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => toggle(step.key, false)}
                        className="h-6 cursor-pointer rounded-full bg-current/12 px-2 text-[11.5px] font-semibold transition-colors hover:bg-current/20 disabled:opacity-60"
                      >
                        Undo
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-current/15 pt-5 text-[13px] font-semibold">
        {STARTED_EXTRAS.map((extra) => (
          <Link
            key={extra.path}
            href={startedHref(orgSlug, extra.path)}
            className="inline-flex h-8 items-center gap-1 rounded-full px-3 ring-1 ring-current/20 transition-colors hover:bg-current/10"
          >
            {extra.label}
            <ArrowUpRight className="size-3.5 opacity-60" aria-hidden="true" />
          </Link>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={hideAll}
          className="ms-auto h-8 cursor-pointer rounded-full px-3.5 text-[13px] font-semibold transition-colors hover:bg-current/10 disabled:opacity-60"
        >
          Hide
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[14px] font-semibold">
          {error}
        </p>
      )}
    </section>
  );
}
