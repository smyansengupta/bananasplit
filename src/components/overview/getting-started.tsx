"use client";

import {
  CalendarPlus,
  Check,
  CheckSquare,
  Copy,
  Database,
  ImagePlus,
  Network,
  PiggyBank,
  Tags,
  UserPlus,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import {
  hideGettingStarted,
  restoreStartedSkipped,
  setStartedStepSkipped,
} from "@/app/app/[orgSlug]/getting-started-actions";
import {
  STARTED_SOLID,
  StartedBlock,
  StartedChips,
  StartedExtra,
  StartedHide,
  StartedSkip,
  StartedTile,
} from "@/components/overview/started-block";
import { toast } from "@/components/ui/toaster";
import {
  STARTED_EXTRAS,
  startedHref,
  startedProgress,
  type StartedState,
  type StartedStepKey,
} from "@/lib/overview/getting-started";

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

  return (
    <StartedBlock
      title="Get your organization started"
      steps={progress.steps.map((step) => ({ ...step, icon: STEP_ICON[step.key] }))}
      error={error}
      finished={
        <StartedChips
          steps={finished.map((step) => ({ ...step, href: startedHref(orgSlug, step.path) }))}
          busy={pending ? busy : null}
          onUndo={(key) => toggle(key as StartedStepKey, false)}
        />
      }
      foot={
        <>
          {STARTED_EXTRAS.map((extra) => (
            <StartedExtra
              key={extra.path}
              href={startedHref(orgSlug, extra.path)}
              label={extra.label}
            />
          ))}
          <StartedHide disabled={pending} onClick={hideAll} />
        </>
      }
    >
      {todo.map((step) => (
        <StartedTile
          key={step.key}
          icon={STEP_ICON[step.key]}
          label={step.label}
          hint={step.hint}
          href={startedHref(orgSlug, step.path)}
        >
          {step.key === "members" && joinLink && (
            <button type="button" onClick={copyLink} className={STARTED_SOLID}>
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy invite link"}
            </button>
          )}
          <StartedSkip
            working={pending && busy === step.key}
            onClick={() => toggle(step.key, true)}
          />
        </StartedTile>
      ))}
    </StartedBlock>
  );
}
