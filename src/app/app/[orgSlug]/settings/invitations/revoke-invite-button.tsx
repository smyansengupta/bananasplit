"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

import { revokeInvitation } from "./actions";

export function RevokeInviteButton({
  orgId,
  invitationId,
  email,
}: {
  orgId: string;
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      aria-label={`Revoke invite for ${email}`}
      onClick={() =>
        startTransition(async () => {
          await revokeInvitation(orgId, invitationId);
          router.refresh();
        })
      }
    >
      {isPending ? "Revoking…" : "Revoke"}
    </Button>
  );
}
