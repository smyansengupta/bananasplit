"use client";

import { AmbientActions } from "@/components/ambient/ambient-button";

import { sendPulseNowAction } from "./actions";

/**
 * Send now, on this week's draft (Buttons canvas, Pulse): it goes out
 * now instead of at the usual time, the same send in every other way.
 */
export function SendPulseNow({
  orgId,
  issueId,
  reason,
}: {
  orgId: string;
  issueId: string;
  reason: string;
}) {
  return (
    <AmbientActions
      why
      className="items-start"
      actions={[
        {
          key: "send",
          label: "Send now",
          reason,
          tone: "solid",
          run: () => sendPulseNowAction(orgId, issueId),
          done: "Sending the pulse now",
        },
      ]}
    />
  );
}
