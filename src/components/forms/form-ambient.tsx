"use client";

import { ChartColumn, Send } from "@/components/icons";
import { AmbientActions, type AmbientAction } from "@/components/ambient/ambient-button";
import { postAnnouncement } from "@/server/announcements/actions";

/**
 * A form's ambient buttons (Buttons canvas, Forms): Share again on one
 * about to close with few answers (it posts the link to everyone, the words
 * written), and Make a report on one that closed with answers.
 */

export interface FormShareAgain {
  /** "12 answers, closes in 2 days". */
  reason: string;
  /** The announcement it posts. */
  title: string;
  body: string;
}

export function shareAgainAction(
  orgId: string,
  share: FormShareAgain,
  formTitle: string,
): AmbientAction {
  return {
    key: "share",
    label: "Share again",
    icon: Send,
    reason: share.reason,
    tone: "solid",
    ariaLabel: `Share ${formTitle} again`,
    run: () => postAnnouncement(orgId, { title: share.title, body: share.body }),
    done: "Posted to everyone",
  };
}

export function FormAmbient({
  orgId,
  formTitle,
  share,
  report,
  className,
}: {
  orgId: string;
  formTitle: string;
  share?: FormShareAgain | null;
  report?: { reason: string; href: string } | null;
  className?: string;
}) {
  return (
    <AmbientActions
      why
      className={className}
      actions={[
        share && shareAgainAction(orgId, share, formTitle),
        report && {
          key: "report",
          label: "Make a report",
          icon: ChartColumn,
          reason: report.reason,
          href: report.href,
        },
      ]}
    />
  );
}
