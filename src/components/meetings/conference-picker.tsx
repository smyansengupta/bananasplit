"use client";

import { useCallback, useEffect, useState } from "react";

import { meetingConnectionsAction } from "@/app/app/[orgSlug]/meetings/actions";
import { Check, ChevronDown, Link2, Video, X } from "@/components/icons";
import { MeetingLogo } from "@/components/meeting-logos";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ConferenceProvider } from "@/generated/prisma/enums";
import { CONFERENCE_PROVIDER_OF as PROVIDER_OF } from "@/lib/meetings/connected-provider";
import type { MeetingConnection } from "@/server/conference/connections";
import { cn } from "@/lib/utils";

/**
 * How an online meeting happens: one menu (docs/features/meetings.md).
 *
 * This was a row of five chips, which is five things to read and a lot of
 * width for a question most people answer once and never think about again.
 * It is one menu now, the last thing the create form asks: you set the
 * meeting up, then say where the call should be.
 *
 * A provider the organization has not connected is still in the menu, with
 * Connect on it, so the answer to "can I use Zoom?" is never "go to an admin
 * page first". Consent opens in a NEW TAB on purpose - a redirect would throw
 * away the half-filled meeting behind this dialog - and coming back re-reads
 * the connections, so the provider you just connected is simply there.
 *
 * The form reads the connections (`useMeetingConnections`) and hands them in,
 * because it needs them too: a new online meeting starts on the first
 * provider that is connected.
 */

/** Re-reads the org's connections, and again whenever this tab regains focus. */
export function useMeetingConnections(orgId: string): MeetingConnection[] | null {
  const [connections, setConnections] = useState<MeetingConnection[] | null>(null);

  const load = useCallback(() => {
    let live = true;
    meetingConnectionsAction(orgId)
      .then((rows) => live && setConnections(rows))
      .catch(() => live && setConnections([]));
    return () => {
      live = false;
    };
  }, [orgId]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    // Connecting happens in another tab; coming back is when this changes.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return connections;
}

export function ConferencePicker({
  connections,
  provider,
  onProviderChange,
  conferenceUrl,
  onUrlChange,
  /** The link this event already has, when we made it. */
  managed,
  disabled,
}: {
  /** The organization's connections (`useMeetingConnections`); null while they load. */
  connections: MeetingConnection[] | null;
  provider: ConferenceProvider;
  onProviderChange: (next: ConferenceProvider) => void;
  conferenceUrl: string;
  onUrlChange: (next: string) => void;
  managed?: boolean;
  disabled?: boolean;
}) {
  const rows = connections ?? [];
  const pasting = provider === ConferenceProvider.OTHER;
  const chosen = rows.find((c) => PROVIDER_OF[c.provider] === provider) ?? null;

  const pick = (next: ConferenceProvider) => {
    onProviderChange(next);
    // A provider that makes the meeting for us fills the link itself.
    if (next !== ConferenceProvider.OTHER && !managed) onUrlChange("");
  };

  const triggerLabel = pasting
    ? "A link I'll paste"
    : provider === ConferenceProvider.NONE
      ? "No video call"
      : (chosen?.label ?? "Online");

  return (
    <div className="grid gap-1.5">
      {/*
        A plain label, not <label for>: an explicit label REPLACES a button's
        accessible name, so the trigger would have read "Video call" and never
        said what was chosen. Pointing aria-labelledby at both gives
        "Video call, Zoom".
      */}
      <span id="event-conference-label" className="text-sm leading-none font-medium select-none">
        Video call
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          id="event-conference"
          aria-labelledby="event-conference-label event-conference"
          disabled={disabled}
          className={cn(
            "border-input bg-background focus-glow flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm outline-none",
            "hover:bg-muted/60 transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {pasting ? (
            <Link2 className="size-4 shrink-0 opacity-70" aria-hidden="true" />
          ) : provider === ConferenceProvider.NONE ? (
            <X className="size-4 shrink-0 opacity-70" aria-hidden="true" />
          ) : chosen ? (
            <MeetingLogo provider={chosen.provider} className="size-4 shrink-0" />
          ) : (
            <Video className="size-4 shrink-0 opacity-70" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          <DropdownMenuItem onSelect={() => pick(ConferenceProvider.NONE)}>
            <X className="opacity-70" aria-hidden="true" />
            <span className="flex-1">No video call</span>
            {provider === ConferenceProvider.NONE && <Check className="opacity-70" aria-hidden="true" />}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {rows.map((c) => {
            const value = PROVIDER_OF[c.provider];
            if (!value) return null;
            // Not connected and nothing to connect with: no point offering it.
            if (!c.connected && !c.available) return null;
            // A provider nobody has connected is shown, so the menu says what
            // is possible, but it is not an action here: connecting leaves
            // this page, and leaving would take the half-typed meeting with
            // it. The bar on Meetings is where you connect one.
            return (
              <DropdownMenuItem
                key={c.provider}
                disabled={!c.connected}
                onSelect={() => c.connected && pick(value)}
              >
                <MeetingLogo provider={c.provider} className={cn(!c.connected && "opacity-60")} />
                <span className="flex-1 truncate">{c.label}</span>
                {c.connected ? (
                  provider === value && <Check className="opacity-70" aria-hidden="true" />
                ) : (
                  <span className="text-muted-foreground text-[13px]">
                    {c.needsReauth ? "Needs reconnecting" : "Not connected"}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => pick(ConferenceProvider.OTHER)}>
            <Link2 className="opacity-70" aria-hidden="true" />
            <span className="flex-1">A link I&apos;ll paste</span>
            {pasting && <Check className="opacity-70" aria-hidden="true" />}
          </DropdownMenuItem>

          {rows.some((c) => !c.connected && c.available) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-[13px] font-normal">
                Connect an account under Video calls in Meetings.
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {pasting && (
        <Input
          aria-label="Meeting link"
          value={conferenceUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={disabled}
          placeholder="https://…"
          className="mt-1"
        />
      )}

      {!pasting && provider !== ConferenceProvider.NONE && (
        <p className="text-muted-foreground text-[13px]">
          {managed && conferenceUrl
            ? "The link is on this meeting already."
            : "The link is made when you save, and goes out with the reminders."}
        </p>
      )}
    </div>
  );
}
