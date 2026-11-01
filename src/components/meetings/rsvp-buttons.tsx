"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { toast } from "@/components/ui/toaster";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import type { RSVPStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const CHOICES: { value: RSVPStatus; label: string }[] = [
  { value: "YES", label: "Going" },
  { value: "MAYBE", label: "Maybe" },
  { value: "NO", label: "No" },
];

/**
 * An invitee's answer, right where the meeting is shown (a Meetings card,
 * the calendar's peek), so replying is one click instead of opening the
 * meeting's page. It answers the same invitation the page's buttons do
 * (rsvpToEvent) and shows the choice at once; a failure puts it back.
 */
export function RsvpButtons({
  orgId,
  eventId,
  title,
  value,
  className,
}: {
  orgId: string;
  eventId: string;
  /** The meeting's title, so a list of these reads "Going: Build night". */
  title: string;
  value: RSVPStatus | null;
  className?: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<RSVPStatus | null>(value);
  const [pending, start] = useTransition();

  const answer = (next: RSVPStatus) => {
    if (next === chosen) return;
    const before = chosen;
    setChosen(next);
    start(async () => {
      const result = await rsvpToEvent(orgId, eventId, next);
      if (result.error) {
        setChosen(before);
        toast({ title: result.error, tone: "error" });
        return;
      }
      router.refresh();
    });
  };

  return (
    <span
      role="radiogroup"
      aria-label={`Your answer: ${title}`}
      aria-busy={pending || undefined}
      className={cn(segmentedTrack, "relative z-10 h-9", className)}
    >
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={chosen === c.value}
          onClick={() => answer(c.value)}
          className={cn(segmentedItem(chosen === c.value), "h-7 px-3")}
        >
          {c.label}
        </button>
      ))}
    </span>
  );
}
