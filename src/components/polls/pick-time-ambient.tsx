"use client";

import { useRouter } from "next/navigation";

import { finalizePoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { AmbientActions } from "@/components/ambient/ambient-button";

/**
 * A find-a-time where one time works for everyone who answered: Pick it,
 * one click, and the meeting is on the calendar with them invited (the
 * same finalizePoll as Schedule). It opens the new meeting.
 */
export function PickTimeAmbient({
  orgId,
  orgSlug,
  pollId,
  slotId,
  label,
  reason,
}: {
  orgId: string;
  orgSlug: string;
  pollId: string;
  slotId: string;
  /** "Thu 6 PM". */
  label: string;
  reason: string;
}) {
  const router = useRouter();
  return (
    <AmbientActions
      why
      className="items-start"
      actions={[
        {
          key: "pick",
          label: `Pick ${label}`,
          reason,
          tone: "solid",
          run: async () => {
            const result = await finalizePoll(orgId, pollId, slotId);
            if (result.eventId) router.push(`/app/${orgSlug}/meetings/${result.eventId}`);
            return result;
          },
          done: `Scheduled for ${label}`,
        },
      ]}
    />
  );
}
