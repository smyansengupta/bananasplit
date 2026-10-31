"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { disconnectMeetingProviderAction } from "@/app/app/[orgSlug]/meetings/actions";
import { Check, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { MeetingConnection } from "@/server/conference/connections";
import { cn } from "@/lib/utils";

/**
 * A video-call provider in its Integrations window: which account it is,
 * Connect (or Reconnect, or switch accounts) straight to the provider's
 * consent screen, and Disconnect, which asks first. The same actions as the
 * Video calls bar on Meetings (src/components/meetings/video-connections.tsx).
 */
export function VideoProviderPanel({
  orgId,
  connection: c,
  canConnect,
}: {
  orgId: string;
  connection: MeetingConnection;
  canConnect: boolean;
}) {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const held = c.connected || c.needsReauth;

  async function disconnect() {
    const confirmed = await confirm({
      title: `Disconnect ${c.label}?`,
      description: `Meetings already made keep their links. Changing or cancelling them won't reach ${c.label} until you connect again.`,
      confirmLabel: "Disconnect",
      run: async () => {
        const outcome = await disconnectMeetingProviderAction(orgId, c.provider);
        if (!outcome.ok) return outcome.message;
        setResult({ ok: true, text: outcome.message });
      },
    });
    if (confirmed) router.refresh();
  }

  return (
    <div className="space-y-4">
      {confirmEl}
      <p className="text-muted-foreground text-sm">
        Online meetings get a {c.label} link automatically.
      </p>
      {held && (
        <p
          className={cn(
            "rounded-tile flex items-center gap-2 p-3 text-sm",
            c.connected
              ? "bg-tint-success text-tint-success-foreground"
              : "bg-tint-danger text-tint-danger-foreground",
          )}
        >
          {c.connected ? (
            <Check className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          )}
          {c.connected
            ? c.accountEmail
              ? `Connected as ${c.accountEmail}`
              : "Connected"
            : "Needs reconnecting"}
        </p>
      )}
      {!c.available && !held && (
        <p className="text-muted-foreground text-sm">
          {c.label} isn&apos;t switched on for Bananasplit yet. You can still paste a link into any
          meeting.
        </p>
      )}
      {result && (
        <p role="status" className={result.ok ? "text-success text-sm" : "text-warning text-sm"}>
          {result.text}
        </p>
      )}
      {canConnect && (c.available || held) && (
        <div className="flex flex-wrap items-center gap-2">
          <form method="post" action={`/api/integrations/conference/${c.slug}/start`}>
            <input type="hidden" name="orgId" value={orgId} />
            <Button type="submit" variant={c.connected ? "outline" : "default"}>
              {c.connected ? "Switch account" : c.needsReauth ? "Reconnect" : "Connect"}
            </Button>
          </form>
          {held && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={disconnect}>
              Disconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
