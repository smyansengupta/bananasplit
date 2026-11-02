"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { createSuggestedReport } from "@/app/app/[orgSlug]/databases/reports/report-actions";

/** Reports home's one-click report: a database's suggested widgets, opened at once. */
export function CreateSuggestedButton({
  orgId,
  orgSlug,
  sourceKey,
  name,
}: {
  orgId: string;
  orgSlug: string;
  sourceKey: string;
  name: string;
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
          const result = await createSuggestedReport(orgId, sourceKey);
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
