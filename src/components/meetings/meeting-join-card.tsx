"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { retryConferenceSync } from "@/app/app/[orgSlug]/meetings/actions";
import { Copy, KeyRound, Loader2, Mic, Phone, RefreshCw, Video } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Fact } from "@/components/ui/fact";
import { toast } from "@/components/ui/toaster";
import type { ConferenceStatus } from "@/lib/meetings/conference-status";
import type { ConferenceDialIn } from "@/server/conference/types";

/**
 * How to get into a meeting, on its page (docs/features/meetings.md): the
 * join link, the passcode and dial-in numbers, and, for the people who run
 * it, the host's own link and a way to try again when making the meeting
 * failed.
 *
 * It sits in the event detail's button row, in place of the plain "Join
 * meeting" button (EventDetailView's `joinCard`).
 *
 * `hostUrl` is the link that starts the meeting as its host. The page passes
 * it only to someone with `events.write` and `null` to everyone else, so it
 * is never in this component's props, or the page's markup, for a member. It
 * is only ever the target of the Start as host link: never printed, and never
 * put in a toast.
 */
export function MeetingJoinCard({
  orgId,
  eventId,
  providerLabel,
  joinUrl,
  hostUrl,
  passcode,
  dialIn,
  status,
  canEdit,
}: {
  orgId: string;
  eventId: string;
  /** "Zoom", "Google Meet": what to call the provider. */
  providerLabel: string;
  joinUrl: string | null;
  hostUrl: string | null;
  passcode: string | null;
  dialIn: ConferenceDialIn[];
  status: ConferenceStatus;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: done, tone: "success", duration: 3000 });
    } catch {
      toast({ title: "Couldn't copy. Your browser blocked the clipboard.", tone: "error" });
    }
  }

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryConferenceSync(orgId, eventId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const hasDetails = Boolean(passcode) || dialIn.length > 0;
  const nothingYet = !joinUrl && !hostUrl && status.kind === "none";

  return (
    <section
      aria-label={`${providerLabel} meeting`}
      className="bg-muted/50 rounded-field w-full space-y-3 p-4"
    >
      <p className="heading flex items-center gap-2 text-[15px]">
        <Video aria-hidden className="size-4" />
        {providerLabel}
      </p>

      {status.kind === "pending" && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {status.line}
        </p>
      )}

      {status.kind === "failed" && (
        <div
          className="bg-tint-danger text-tint-danger-foreground rounded-field space-y-2 p-3.5 text-sm"
          role="note"
        >
          <p className="font-medium">{status.line}</p>
          {status.reason && <p>{status.reason}</p>}
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={retry} disabled={isPending}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
          )}
          {error && (
            <p role="alert" className="font-medium">
              {error}
            </p>
          )}
        </div>
      )}

      {(joinUrl || hostUrl) && (
        <div className="flex flex-wrap gap-2">
          {joinUrl && (
            <>
              <Button asChild>
                <a href={joinUrl} target="_blank" rel="noopener noreferrer">
                  <Video aria-hidden />
                  Join meeting
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copy(joinUrl, "Link copied")}
              >
                <Copy aria-hidden />
                Copy link
              </Button>
            </>
          )}
          {hostUrl && (
            <Button variant="outline" asChild>
              <a href={hostUrl} target="_blank" rel="noopener noreferrer">
                <Mic aria-hidden />
                Start as host
              </a>
            </Button>
          )}
        </div>
      )}

      {hasDetails && (
        <dl className="grid gap-1">
          {passcode && (
            <Fact icon={KeyRound} label="Passcode">
              <span className="flex items-center gap-1.5">
                <span className="tabular-nums">{passcode}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Copy passcode"
                  onClick={() => void copy(passcode, "Passcode copied")}
                >
                  <Copy aria-hidden />
                </Button>
              </span>
            </Fact>
          )}
          {dialIn.length > 0 && (
            <Fact icon={Phone} label="Dial in">
              <ul className="space-y-1">
                {dialIn.map((entry, i) => (
                  <li key={`${entry.number}-${i}`} className="tabular-nums">
                    {[entry.country, entry.number, entry.pin ? `PIN ${entry.pin}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
        </dl>
      )}

      {nothingYet && <p className="text-muted-foreground text-sm">No join link yet.</p>}
    </section>
  );
}
