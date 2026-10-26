"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { disconnectMeetingProviderAction } from "@/app/app/[orgSlug]/meetings/actions";
import { Check, TriangleAlert } from "@/components/icons";
import { MeetingLogo } from "@/components/meeting-logos";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { MeetingConnection } from "@/server/conference/connections";
import { cn } from "@/lib/utils";


/**
 * Video calls: one bar across the top of Meetings
 * (docs/features/meetings.md).
 *
 * Each provider is its own button here, and pressing one goes straight to
 * that provider's consent screen. No menu: this bar exists to be acted on
 * once, and a dropdown would put a click in front of the only thing anyone
 * comes here to do. The menu belongs in the create form, where picking a
 * provider is a choice among options you already have.
 *
 * Consent opens in a new tab, so this page stays where it was.
 *
 * A connected provider also says which account it is and can be disconnected
 * from the same row. Disconnecting asks first, because what it costs is not
 * obvious: meetings already made keep their links, but changing or cancelling
 * one stops reaching the provider until someone connects again.
 */
export function VideoConnections({
  orgId,
  connections,
  canConnect,
  /** How the last connect attempt went, if the page came back from one. */
  notice = null,
  /**
   * Whoever runs this Bananasplit (PLATFORM_ADMIN_EMAILS). Only they can
   * switch a provider on, so only they are told what is missing.
   */
  platformAdmin = false,
  className,
}: {
  orgId: string;
  connections: readonly MeetingConnection[];
  canConnect: boolean;
  notice?: { ok: boolean; text: string } | null;
  platformAdmin?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  /** How the last disconnect went. Wins over the page's own notice until the next one. */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const live = connections.filter((c) => c.connected);
  // Only what a club can actually connect. A provider this platform has no
  // OAuth app for is not something a club admin can fix - it is set up once,
  // for everyone, by whoever runs Bananasplit - so it is not offered here as
  // if it were one button away. A connection we already hold, even one that
  // needs reconnecting, always has its row: it has to be disconnectable.
  const offerable = connections.filter((c) => c.connected || c.needsReauth || c.available);
  const unavailable = connections.filter((c) => !c.connected && !c.needsReauth && !c.available);
  const shown = result ?? notice;

  async function disconnect(c: MeetingConnection) {
    const confirmed = await confirm({
      title: `Disconnect ${c.label}?`,
      description: `Meetings already made keep their links. Changing or cancelling them won't reach ${c.label} until you connect again.`,
      confirmLabel: "Disconnect",
      // A refusal keeps the dialog open with the reason; success closes it.
      run: async () => {
        const outcome = await disconnectMeetingProviderAction(orgId, c.provider);
        if (!outcome.ok) return outcome.message;
        setResult({ ok: true, text: outcome.message });
      },
    });
    if (confirmed) router.refresh();
  }

  // Nothing connected and nothing an admin could do about it: say nothing.
  if (!canConnect && live.length === 0) return null;
  // Nothing switched on for the platform yet: one honest line, and for the
  // person who can switch them on, exactly what is missing.
  if (offerable.length === 0) {
    return (
      <section
        className={cn(
          "bg-card text-card-foreground edge rounded-card flex flex-col gap-1 px-4.5 py-3",
          className,
        )}
      >
        <span className="text-sm font-semibold">Video calls</span>
        <span className="text-muted-foreground text-[13px]">
          {platformAdmin
            ? `Google Meet, Zoom and Teams need an app with each provider before any club can connect them. Add ${unavailable
                .flatMap((c) => c.missingEnv.slice(0, 1))
                .join(", ")} and their secrets to this deployment (docs/setup/meeting-providers.md has the steps).`
            : "Joining links for Google Meet, Zoom and Teams aren't switched on for Bananasplit yet. You can still paste a link into any meeting."}
        </span>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "bg-card text-card-foreground edge rounded-card flex flex-wrap items-center gap-x-4 gap-y-3 px-4.5 py-3",
        className,
      )}
    >
      {confirmEl}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">Video calls</span>
        <span className="text-muted-foreground text-[13px]">
          {shown ? (
            <span
              role="status"
              className={cn(
                "flex items-center gap-1.5",
                shown.ok ? "text-success" : "text-warning",
              )}
            >
              {shown.ok ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="text-foreground">{shown.text}</span>
            </span>
          ) : live.length === 0 ? (
            "Connect an account and every online meeting gets a join link automatically."
          ) : (
            `Online meetings are created in ${live.map((c) => c.accountEmail ?? c.label).join(", ")}.`
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {offerable.map((c) => (
          <div key={c.provider} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* A plain form POST that navigates, the same shape as the Google
                Calendar connect next door. Not a new tab: a popup can be
                blocked, and a connect flow that silently does nothing is worse
                than one that takes you there and brings you back to this page. */}
            <form method="post" action={`/api/integrations/conference/${c.slug}/start`}>
              <input type="hidden" name="orgId" value={orgId} />
              <button
                type="submit"
                disabled={!canConnect}
                title={
                  c.connected
                    ? `Connect a different ${c.label} account`
                    : `Connect ${c.label}`
                }
                className={cn(
                  "focus-glow inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium outline-none",
                  "transition-[background-color,border-color,scale] duration-150 active:scale-[0.98]",
                  "motion-reduce:transition-none motion-reduce:active:scale-100",
                  "disabled:pointer-events-none disabled:opacity-50",
                  c.connected
                    ? "border-success/30 bg-success/5 hover:bg-success/10"
                    : c.needsReauth
                      ? "border-warning/40 bg-warning/5 hover:bg-warning/10"
                      : "border-primary/25 bg-primary/5 hover:bg-primary/10",
                )}
              >
                <MeetingLogo provider={c.provider} className="size-[18px] shrink-0" />
                <span>{c.label}</span>
                {c.connected ? (
                  <Check className="text-success size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <span className="text-muted-foreground text-[13px]">
                    {c.needsReauth ? "Reconnect" : "Connect"}
                  </span>
                )}
              </button>
            </form>
            {(c.connected || c.needsReauth) && (
              <>
                <span className="text-muted-foreground text-[13px]">
                  {c.accountEmail
                    ? `Connected as ${c.accountEmail}`
                    : c.connected
                      ? "Connected"
                      : "Needs reconnecting"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canConnect}
                  aria-label={`Disconnect ${c.label}`}
                  onClick={() => void disconnect(c)}
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>
        ))}

        {platformAdmin && unavailable.length > 0 && (
          <span
            className="text-muted-foreground text-[13px]"
            title={unavailable.flatMap((c) => c.missingEnv).join(", ")}
          >
            {unavailable.map((c) => c.label).join(", ")}: no app yet
          </span>
        )}
      </div>
    </section>
  );
}
