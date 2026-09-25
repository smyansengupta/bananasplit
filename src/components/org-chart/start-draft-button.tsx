"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { Button } from "@/components/ui/button";

/** "Edit the chart" / "Start from scratch": creates a MANUAL draft and opens it. */
export function StartDraftButton({
  orgId,
  orgSlug,
  from,
  children,
  variant = "outline",
  size = "sm",
}: {
  orgId: string;
  orgSlug: string;
  from: "blank" | "current";
  children: React.ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startDraftAction(orgId, from);
            if (result.ok && "versionId" in result)
              router.push(`/app/${orgSlug}/org-chart/drafts/${result.versionId}`);
            else setError("error" in result ? result.error : "The draft could not be started.");
          })
        }
      >
        {pending ? "Opening…" : children}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
