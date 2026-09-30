"use client";

import {
  CalendarPlus,
  Check,
  CheckSquare,
  ImageUp,
  NotebookPen,
  PiggyBank,
  Rocket,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface GettingStartedState {
  members: boolean;
  picture: boolean;
  event: boolean;
  task: boolean;
  budget: boolean;
  note: boolean;
}

const STEPS: { key: keyof GettingStartedState; label: string; hint: string; icon: LucideIcon; href: (slug: string) => string }[] = [
  { key: "members", label: "Invite your members", hint: "Share the invite code or send email invites.", icon: UserPlus, href: (s) => `/app/${s}/settings/members` },
  { key: "picture", label: "Add a club picture", hint: "It shows in the sidebar and on the join page.", icon: ImageUp, href: (s) => `/app/${s}/settings/general` },
  { key: "event", label: "Put your first meeting on the calendar", hint: "Members see it on their Overview.", icon: CalendarPlus, href: (s) => `/app/${s}/calendar` },
  { key: "task", label: "Create a task", hint: "Give someone something to own.", icon: CheckSquare, href: (s) => `/app/${s}/tasks` },
  { key: "budget", label: "Set up the budget", hint: "A period and its categories, for the treasurer.", icon: PiggyBank, href: (s) => `/app/${s}/finance/budget` },
  { key: "note", label: "Write or import a note", hint: "Minutes, plans, or a Word doc you already have.", icon: NotebookPen, href: (s) => `/app/${s}/notes` },
];

const HIDE_KEY = (orgSlug: string) => `getting-started-hidden:${orgSlug}`;

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readHidden(orgSlug: string): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY(orgSlug)) === "1";
  } catch {
    // Storage blocked: the card simply shows.
    return false;
  }
}

/**
 * A new club's first steps, for owners and admins, worked out from what the
 * org actually has. It goes away by itself when everything is done, or when
 * hidden (remembered on this device).
 */
export function GettingStartedCard({ orgSlug, state }: { orgSlug: string; state: GettingStartedState }) {
  const [hiddenNow, setHidden] = useState(false);
  const hiddenBefore = useSyncExternalStore(
    subscribeStorage,
    () => readHidden(orgSlug),
    () => false,
  );
  const hidden = hiddenNow || hiddenBefore;

  const done = STEPS.filter((s) => state[s.key]).length;
  if (hidden || done === STEPS.length) return null;

  return (
    <Card className="border-primary/25 from-primary/5 bg-gradient-to-br to-transparent">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="bg-primary/15 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
            <Rocket className="size-4.5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Get your club started</CardTitle>
            <CardDescription>
              {done} of {STEPS.length} done. Each one takes a minute.
            </CardDescription>
          </div>
        </div>
        <button
          type="button"
          aria-label="Hide the getting started list"
          onClick={() => {
            setHidden(true);
            try {
              window.localStorage.setItem(HIDE_KEY(orgSlug), "1");
            } catch {
              // Ignore: it hides for this visit.
            }
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(done / STEPS.length) * 100}%` }} />
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step) => {
            const complete = state[step.key];
            const Icon = step.icon;
            return (
              <li key={step.key}>
                <Link
                  href={step.href(orgSlug)}
                  className={cn(
                    "hover:bg-accent/50 flex h-full items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                    complete && "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border",
                      complete ? "bg-success text-success-foreground border-transparent" : "text-muted-foreground",
                    )}
                  >
                    {complete ? <Check className="size-3.5" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium", complete && "line-through")}>{step.label}</span>
                    <span className="text-muted-foreground block text-xs">{step.hint}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
