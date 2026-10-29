"use client";

import { EmptyState } from "@/components/empty-state";

export default function OrgSegmentError({ error }: { error: Error & { digest?: string } }) {
  const isForbidden = error.name === "ForbiddenError";

  return (
    <div className="p-6">
      <EmptyState
        title={isForbidden ? "You don't have access to this" : "Something went wrong"}
        description={
          isForbidden
            ? "Your role in this organization doesn't allow this action."
            : "Try reloading the page. If it keeps happening, let your e-board know."
        }
      />
    </div>
  );
}
