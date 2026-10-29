"use client";

import { Sparkles } from "@/components/icons";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PLAN_NAMES, TEAM_FREE_MEMBER_CAP } from "@/lib/billing/features";

/**
 * "Your free trial is up": a dialog shown once, the first time an owner or
 * admin opens a space after its trial ended without a plan being picked
 * (the org layout decides that with trialJustEnded). Seen once per trial
 * per browser: the key is the space and its trial's end, in localStorage.
 * A private window that refuses storage shows it once per visit instead.
 */
const noSubscribe = () => () => {};

function readSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false; // Storage refused: show it, and it hides once closed.
  }
}

/** What the drop takes away, and how to get it back. */
function lostOnDrop(personal: boolean, plan: string, trialPlan: string): string {
  if (personal) return `Themes, integrations and AI come back with ${trialPlan}.`;
  if (plan === PLAN_NAMES.TEAM_FREE) {
    return `Free has room for ${TEAM_FREE_MEMBER_CAP} members (everyone already in stays). Finance, the org chart, integrations, iMessage and reports come back with Team or Team Advanced.`;
  }
  return `iMessage, working on the go, reports and AI come back with ${trialPlan}.`;
}

export function TrialEndedDialog({
  orgId,
  orgSlug,
  trialEnd,
  trialPlan,
  freePlan,
  personal,
}: {
  orgId: string;
  orgSlug: string;
  /** The trial's end, as an ISO string (part of the key). */
  trialEnd: string;
  /** "Team Advanced", "Personal Plus". */
  trialPlan: string;
  /** The plan it dropped to: "Free", "Team" (picked during the trial), "Personal Free". */
  freePlan: string;
  personal: boolean;
}) {
  const key = `bananasplit:trial-ended:${orgId}:${trialEnd}`;
  // Seen on the server render (nothing shows until the browser has read storage).
  const seen = useSyncExternalStore(
    noSubscribe,
    () => readSeen(key),
    () => true,
  );
  const [closed, setClosed] = useState(false);
  const open = !seen && !closed;

  function close(next: boolean) {
    if (next) return;
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Private windows may refuse storage: it just shows again next visit.
    }
    setClosed(true);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="bg-banana/25 grid size-10 place-items-center rounded-full">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <DialogTitle className="text-xl">Your free trial is up</DialogTitle>
          <DialogDescription className="text-[15px] leading-[1.55]">
            Your free trial of {trialPlan} has ended, so{" "}
            {personal ? "you've" : "your organization has"} been set back down to {freePlan}.
            Nothing was deleted. {lostOnDrop(personal, freePlan, trialPlan)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Stay on {freePlan}</Button>
          </DialogClose>
          <Button asChild onClick={() => close(false)}>
            <Link href={`/app/${orgSlug}/settings/plan`}>See plans</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
