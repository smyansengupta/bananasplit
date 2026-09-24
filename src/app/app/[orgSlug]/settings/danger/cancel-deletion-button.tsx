"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { cancelDeletionAction } from "./actions";

export function CancelDeletionButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await cancelDeletionAction(orgId);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {isPending ? "Cancelling…" : "Cancel deletion"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
