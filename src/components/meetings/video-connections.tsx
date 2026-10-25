"use client";

import { Check, TriangleAlert } from "@/components/icons";
import { MeetingLogo } from "@/components/meeting-logos";
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
 */
export function VideoConnections({
  orgId,
  connections,
  canConnect,
  /** How the last connect attempt went, if the page came back from one. */
  notice = null,
  className,
}: {
  orgId: string;
  connections: readonly MeetingConnection[];
  canConnect: boolean;
  notice?: { ok: boolean; text: string } | null;
  className?: string;
}) {
  const live = connections.filter((c) => c.connected);
  const offerable = connections.filter((c) => c.connected || c.available);
  const unavailable = connections.filter((c) => !c.connected && !c.available);

  // Nothing connected and nothing an admin could do about it: say nothing.
  if (!canConnect && live.length === 0) return null;

  return (
    <section
      className={cn(
        "bg-card text-card-foreground edge rounded-card flex flex-wrap items-center gap-x-4 gap-y-3 px-4.5 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">Video calls</span>
        <span className="text-muted-foreground text-[13px]">
          {notice ? (
            <span
              role="status"
              className={cn(
                "flex items-center gap-1.5",
                notice.ok ? "text-success" : "text-warning",
              )}
            >
              {notice.ok ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="text-foreground">{notice.text}</span>
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
          // A plain form POST that navigates, the same shape as the Google
          // Calendar connect next door. Not a new tab: a popup can be blocked,
          // and a connect flow that silently does nothing is worse than one
          // that takes you there and brings you back to this page.
          <form
            key={c.provider}
            method="post"
            action={`/api/integrations/conference/${c.slug}/start`}
          >
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
        ))}

        {unavailable.length > 0 && (
          <span className="text-muted-foreground text-[13px]">
            {unavailable.map((c) => c.label).join(", ")}{" "}
            {unavailable.length === 1 ? "isn't set up yet" : "aren't set up yet"}
          </span>
        )}
      </div>
    </section>
  );
}
