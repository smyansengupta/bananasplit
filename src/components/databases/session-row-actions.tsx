"use client";

import { Merge } from "@/components/icons";
import { useState } from "react";

import { deleteSessionAction, dismissReviewAction } from "@/app/app/[orgSlug]/databases/actions";

import { ActionButton, ActionMenu } from "./action-button";
import { MergeSessionPicker } from "./merge-session-picker";
import { SessionFormDialog, type SessionFormInitial } from "./session-form-dialog";

/**
 * A session's admin controls in the row drawer: Edit, "Not a duplicate"
 * while the sync has flagged it, and the "…" menu with Merge (opens the
 * picker below) and Delete.
 */
export function SessionRowActions({
  organizationId,
  timezone,
  members,
  initial,
  needsReview,
  mergeCandidates,
}: {
  organizationId: string;
  timezone: string;
  members: { id: string; name: string | null }[];
  initial: SessionFormInitial;
  needsReview: boolean;
  mergeCandidates: { id: string; label: string }[];
}) {
  const [merging, setMerging] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SessionFormDialog
          organizationId={organizationId}
          timezone={timezone}
          members={members}
          initial={initial}
        />
        {needsReview && (
          <ActionButton action={dismissReviewAction} args={[organizationId, initial.id]}>
            Not a duplicate
          </ActionButton>
        )}
        <ActionMenu
          label={`More actions for ${initial.title}`}
          items={[
            {
              label: "Delete session",
              action: deleteSessionAction,
              args: [organizationId, initial.id],
              confirm: "Delete this session?",
              confirmDescription:
                "It also disappears from the calendar. Its check-ins stay attached.",
              destructive: true,
            },
          ]}
          extra={[
            { label: "Merge into another session…", icon: Merge, onSelect: () => setMerging(true) },
          ]}
        />
      </div>
      {merging && (
        <MergeSessionPicker
          organizationId={organizationId}
          loserId={initial.id}
          loserTitle={initial.title}
          candidates={mergeCandidates}
          startOpen
          onCancel={() => setMerging(false)}
        />
      )}
    </div>
  );
}
