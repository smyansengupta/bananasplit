"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { acceptInvitationAction } from "./actions";

export function JoinButton({ token, orgName }: { token: string; orgName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInvitationAction(token);
            if (result?.error) setError(result.error);
          })
        }
      >
        {isPending ? "Joining…" : `Join ${orgName}`}
      </Button>
    </div>
  );
}
