import { Check } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export interface GettingStartedState {
  members: boolean;
  picture: boolean;
  event: boolean;
  task: boolean;
  budget: boolean;
  note: boolean;
}

const STEPS: { key: keyof GettingStartedState; label: string; hint: string; href: (slug: string) => string }[] = [
  { key: "members", label: "Invite your members", hint: "Share the invite code or send email invites.", href: (s) => `/app/${s}/settings/members` },
  { key: "picture", label: "Add a club picture", hint: "It shows in the sidebar and on the join page.", href: (s) => `/app/${s}/settings/general` },
  { key: "event", label: "Put your first meeting on the calendar", hint: "Members see it on their Overview.", href: (s) => `/app/${s}/calendar` },
  { key: "task", label: "Create a task", hint: "Give someone something to own.", href: (s) => `/app/${s}/tasks` },
  { key: "budget", label: "Set up the budget", hint: "A period and its categories, for the treasurer.", href: (s) => `/app/${s}/finance/budget` },
  { key: "note", label: "Write or import a note", hint: "Minutes, plans, or a Word doc you already have.", href: (s) => `/app/${s}/notes` },
];

/**
 * A new club's first steps, for owners and admins, worked out from what the
 * org actually has. It lives in a board widget: removing the widget hides it.
 */
export function GettingStartedCard({ orgSlug, state }: { orgSlug: string; state: GettingStartedState }) {
  const done = STEPS.filter((s) => state[s.key]).length;
  if (done === STEPS.length) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Check className="text-success size-4" aria-hidden="true" />
        All set up. You can remove this widget.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {done} of {STEPS.length} done
      </p>
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {STEPS.map((step) => {
          const complete = state[step.key];
          return (
            <li key={step.key} className="border-t">
              <Link
                href={step.href(orgSlug)}
                className="hover:bg-accent/50 -mx-1.5 flex items-start gap-2.5 rounded-md px-1.5 py-2.5 transition-colors"
              >
                {complete ? (
                  <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-[1.5px]" />
                )}
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", complete && "text-muted-foreground line-through")}>
                    {step.label}
                    <span className="sr-only">{complete ? " (done)" : " (to do)"}</span>
                  </span>
                  <span className="text-muted-foreground block text-xs">{step.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
