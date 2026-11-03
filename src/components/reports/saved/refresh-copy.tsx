"use client";

import { useRouter } from "next/navigation";

import { refreshCopyAction } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { RefreshCw } from "@/components/icons";

/**
 * A kept copy's "Refresh" (its data changed since): a new copy over the
 * same dates, opened at once.
 */
export function RefreshCopy({
  orgId,
  orgSlug,
  reportId,
  rangeLabel,
  reason,
}: {
  orgId: string;
  orgSlug: string;
  reportId: string;
  rangeLabel: string;
  reason: string;
}) {
  const router = useRouter();
  return (
    <AmbientActions
      why
      actions={[
        {
          key: "refresh",
          label: "Refresh",
          icon: RefreshCw,
          reason,
          tone: "solid",
          run: async () => {
            const made = await refreshCopyAction(orgId, reportId, rangeLabel);
            if (made.ok)
              router.push(`/app/${orgSlug}/databases/reports/${reportId}/past/${made.id}`);
            return made;
          },
          done: "Kept a fresh copy",
        },
      ]}
    />
  );
}
