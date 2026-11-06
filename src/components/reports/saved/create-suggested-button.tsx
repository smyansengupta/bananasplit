"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { createSuggestedReport, openReadyReport } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import type { ReadyKind } from "@/lib/reports/crm-ready";

/**
 * Reports home's one-click report: a database's suggested widgets, or one
 * of the CRM's ready-made reports (`ready`), opened at once.
 */
export function CreateSuggestedButton({
  orgId,
  orgSlug,
  sourceKey,
  name,
  ready,
}: {
  orgId: string;
  orgSlug: string;
  sourceKey: string;
  name: string;
  ready?: ReadyKind;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      aria-label={`Make the ${name} report`}
      onClick={() =>
        start(async () => {
          const result = ready
            ? await openReadyReport(orgId, ready, sourceKey)
            : await createSuggestedReport(orgId, sourceKey);
          if (!result.ok) {
            toast({ title: result.error });
            return;
          }
          router.push(`/app/${orgSlug}/databases/reports/${result.id}`);
        })
      }
    >
      {pending ? "Making it…" : "Make this report"}
    </Button>
  );
}
