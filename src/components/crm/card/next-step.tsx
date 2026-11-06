"use client";

import { useState } from "react";

import { closeStepAction, setFollowUpAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AmbientButton, AmbientWhy, type AmbientAction } from "@/components/ambient/ambient-button";

/**
 * Always one next step (docs/features/crm.md, "Redesign"): the step with
 * Done and Push; after Done, the likely next ones to pick from; with none,
 * one button to add one. Built on the follow-up date and the steps a
 * sequence leaves, through outreach's own actions.
 */

export interface NextStep {
  kind: "followup" | "step";
  /** The sequence step's activity (kind "step"). */
  id: string | null;
  label: string;
  at: string;
}

const DAY = 86_400_000;

/** "today", "tomorrow", "in 3 days", "2 days late", or the date. */
export function dueWords(at: Date, now: Date = new Date()): { words: string; late: boolean } {
  const start = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start(at) - start(now)) / DAY);
  if (days === 0) return { words: "today", late: false };
  if (days === 1) return { words: "tomorrow", late: false };
  if (days === -1) return { words: "a day late", late: true };
  if (days < 0) return { words: `${-days} days late`, late: true };
  if (days < 7) return { words: `in ${days} days`, late: false };
  return { words: at.toLocaleDateString("en-US", { month: "short", day: "numeric" }), late: false };
}

function dayOf(at: Date): string {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const NEXT = [
  { days: 3, label: "Follow up in 3 days" },
  { days: 7, label: "In a week" },
] as const;

export function NextStepBar({
  orgId,
  personId,
  step,
}: {
  orgId: string;
  personId: string;
  step: NextStep | null;
}) {
  const [stage, setStage] = useState<"open" | "next" | "set">("open");
  const [picked, setPicked] = useState<string | null>(null);

  const offer = (): AmbientAction[] =>
    NEXT.map((n) => ({
      key: `next-${n.days}`,
      label: n.label,
      tone: "outline",
      reason: "Keeps one next step on them",
      run: async () => {
        const r = await setFollowUpAction(orgId, personId, n.days);
        if (r.ok) {
          setPicked(dueWords(new Date(Date.now() + n.days * DAY)).words);
          setStage("set");
        }
        return r;
      },
    }));

  if (stage === "set") {
    return (
      <Bar>
        <span className="min-w-0 flex-1">
          <b>Next:</b> follow up {picked}
        </span>
        <AmbientButton
          action={{
            key: "undo-next",
            label: "Undo",
            reason: "Takes the next step off again",
            run: async () => {
              const r = await setFollowUpAction(orgId, personId, null);
              if (r.ok) setStage("next");
              return r;
            },
          }}
        />
      </Bar>
    );
  }

  if (stage === "next") {
    return (
      <Bar>
        <span className="min-w-0">
          <b>Done.</b> What&apos;s next?
        </span>
        <span className={SIDE}>
          <AmbientWhy className="me-1">Keeps one next step on them</AmbientWhy>
          {offer().map((a) => (
            <AmbientButton key={a.key} action={a} />
          ))}
        </span>
      </Bar>
    );
  }

  if (!step) {
    return (
      <Bar>
        <span className="min-w-0">
          <b>No next step</b>
        </span>
        <span className={SIDE}>
          <AmbientWhy className="me-1">Nothing planned with them</AmbientWhy>
          <AmbientButton
            action={{
              key: "add",
              label: "Add a next step",
              tone: "spark",
              reason: "Nothing planned with them",
              run: async () => {
                setStage("next");
                return {};
              },
            }}
          />
        </span>
      </Bar>
    );
  }

  const due = dueWords(new Date(step.at));
  const actions: AmbientAction[] = [
    {
      key: "done",
      label: "Done",
      tone: "solid",
      reason: due.late ? `It was due ${due.words.replace(" late", " ago")}` : `Due ${due.words}`,
      run: async () => {
        const r =
          step.kind === "step" && step.id
            ? await closeStepAction(orgId, step.id)
            : await setFollowUpAction(orgId, personId, null);
        if (r.ok) setStage("next");
        return r;
      },
    },
  ];
  if (step.kind === "followup") {
    actions.push({
      key: "push",
      label: "Push",
      tone: "outline",
      reason: "To tomorrow",
      done: "Pushed to tomorrow.",
      run: () => setFollowUpAction(orgId, personId, 1),
    });
  }
  return (
    <Bar>
      <span className="min-w-0">
        <b>Next:</b> {step.label.charAt(0).toLowerCase() + step.label.slice(1)},{" "}
        {due.words === "today" || due.words === "tomorrow" ? due.words : dayOf(new Date(step.at))}
      </span>
      <span className={SIDE}>
        <AmbientWhy className="me-1">
          {due.late ? due.words.charAt(0).toUpperCase() + due.words.slice(1) : `Due ${due.words}`}
        </AmbientWhy>
        {actions.map((a) => (
          <AmbientButton key={a.key} action={a} />
        ))}
      </span>
    </Bar>
  );
}

/** The reason and buttons: on the right, wrapping under the label when the card is narrow. */
const SIDE = "ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5";

/** The bar wraps rather than cutting the label, so the label, reason and buttons all read. */
function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl px-4 py-2.5 text-[15px]">
      {children}
    </div>
  );
}
