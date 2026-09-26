"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { joinPendingInvitationAction } from "./actions";

export function PendingInviteCard({
  invitation,
}: {
  invitation: { id: string; role: string; orgName: string };
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-4 sm:flex-row">
        <div>
          <CardTitle>{invitation.orgName}</CardTitle>
          <CardDescription>Invited as {invitation.role.toLowerCase()}</CardDescription>
          {error && <p className="text-destructive mt-1 text-sm">{error}</p>}
        </div>
        <Button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await joinPendingInvitationAction(invitation.id);
              if (result?.error) setError(result.error);
            })
          }
        >
          {isPending ? "Joining…" : "Join"}
        </Button>
      </CardHeader>
    </Card>
  );
}
