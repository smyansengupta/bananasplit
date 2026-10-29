"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { pill } from "@/components/brand/pill";
import { usePreviewNext } from "@/components/onboarding/preview-flow";
import { cn } from "@/lib/utils";

import { joinPendingInvitationAction } from "./actions";
import { CHOICE_CARD } from "./choice-card";

/** What an invite card shows. */
export interface PendingInviteView {
  id: string;
  role: string;
  orgName: string;
  /** The organization's picture, or null (its first letter is drawn instead). */
  orgLogoUrl: string | null;
}

/**
 * An email invite waiting for this address: the organization's picture and
 * name, the role, and Join. Styled like the start page's choices.
 */
export function PendingInviteCard({ invitation }: { invitation: PendingInviteView }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const preview = usePreviewNext();

  return (
    <div className={CHOICE_CARD}>
      {invitation.orgLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small blob-hosted logo
        <img
          src={invitation.orgLogoUrl}
          alt=""
          width={40}
          height={40}
          className="size-10 flex-none rounded-[12px] object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="bg-muted grid size-10 flex-none place-items-center rounded-[12px] text-[16px] font-bold"
        >
          {invitation.orgName.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{invitation.orgName}</span>
        <span className="text-muted-foreground text-[13px]">
          {error ?? `As ${invitation.role.toLowerCase()}`}
        </span>
      </span>
      <button
        type="button"
        disabled={isPending}
        className={cn(pill({ size: "sm" }), "flex-none px-4")}
        onClick={() =>
          preview
            ? router.push(preview)
            : startTransition(async () => {
                const result = await joinPendingInvitationAction(invitation.id);
                if (result?.error) setError(result.error);
              })
        }
      >
        {isPending ? "Joining…" : "Join"}
      </button>
    </div>
  );
}
