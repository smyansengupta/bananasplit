"use client";

import { retryGoogleSync } from "@/app/app/[orgSlug]/calendar/sync/actions";
import { AmbientActions } from "@/components/ambient/ambient-button";

/** Retry sync: an event that didn't reach Google Calendar goes again. */
export function RetrySync({ orgId, eventId }: { orgId: string; eventId: string }) {
  return (
    <AmbientActions
      actions={[
        {
          key: "retry-sync",
          label: "Retry sync",
          reason: "It didn't reach Google Calendar",
          run: () => retryGoogleSync(orgId, eventId),
          done: "Sent to Google again",
        },
      ]}
    />
  );
}
