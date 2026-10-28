"use client";

import { Mail } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { SettingsCard, SettingsStatus } from "../settings-card";
import { resendInvitation, revokeInvitation } from "./actions";

export interface PendingInviteRow {
  id: string;
  email: string;
  role: string;
  /** ISO string. */
  expiresAt: string;
  expired: boolean;
  invitedByName: string | null;
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function InviteRow({ orgId, invite }: { orgId: string; invite: PendingInviteRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  function run(action: () => Promise<{ error?: string } | undefined>, ok: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setMessage({ tone: "error", text: result.error });
      else {
        setMessage({ tone: "ok", text: ok });
        router.refresh();
      }
    });
  }

  return (
    <li className="hover:bg-muted/60 rounded-field -mx-2 flex flex-wrap items-center justify-between gap-3 px-2 py-3 text-sm transition-colors">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{invite.email}</span>
          {invite.expired ? (
            <Badge variant="destructive">Expired</Badge>
          ) : (
            <Badge variant="secondary">Pending</Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 text-[13px]">
          Invited as {invite.role.toLowerCase()}
          {invite.invitedByName ? ` by ${invite.invitedByName}` : ""} ·{" "}
          {invite.expired ? "expired" : "expires"} {dateFormat.format(new Date(invite.expiresAt))}
        </div>
        <SettingsStatus status={message} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          aria-label={`Resend invite to ${invite.email}`}
          onClick={() => run(() => resendInvitation(orgId, invite.id), "A new link is on its way.")}
        >
          Resend
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          aria-label={`Revoke invite for ${invite.email}`}
          onClick={() => run(() => revokeInvitation(orgId, invite.id), "Invite revoked.")}
        >
          Revoke
        </Button>
      </div>
    </li>
  );
}

/** The invites not yet accepted, as hairline rows in their own card. */
export function PendingInvites({ orgId, invites }: { orgId: string; invites: PendingInviteRow[] }) {
  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          Pending invites
          {invites.length > 0 && <Badge variant="secondary">{invites.length}</Badge>}
        </span>
      }
    >
      {invites.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Mail}
          title="No pending invites."
          description="Invites you send show here until they're accepted."
          className="py-0"
        />
      ) : (
        <ul className="divide-border/70 divide-y">
          {invites.map((invite) => (
            <InviteRow key={invite.id} orgId={orgId} invite={invite} />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
