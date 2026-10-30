"use client";

import { useCallback, useEffect, useState } from "react";

import { meetingConnectionsAction } from "@/app/app/[orgSlug]/meetings/actions";
import { Link2, X } from "@/components/icons";
import { MeetingLogo } from "@/components/meeting-logos";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { ConferenceProvider } from "@/generated/prisma/enums";
import { CONFERENCE_PROVIDER_OF as PROVIDER_OF } from "@/lib/meetings/connected-provider";
import type { MeetingConnection } from "@/server/conference/connections";
import { cn } from "@/lib/utils";

/**
 * How an online meeting happens (docs/features/meetings.md): one button
 * per choice (None, each provider, Paste link), the last thing the create
 * form asks. It was a menu for a while; Jack wants direct buttons here, as
 * on Meetings' Video calls bar.
 *
 * A provider the organization has not connected is still shown, so the row
 * says what is possible, but greyed, with a hint pointing at Video calls in
 * Meetings. Connecting
 * is not done from here: it is a form POST there that navigates to the
 * provider and back, which would throw away the half-filled meeting behind
 * this dialog. The connections are read again whenever the tab regains focus,
 * so a provider connected in another tab is simply there.
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
    // Someone may connect one from Meetings in another tab; coming back here
    // is when that shows.
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
    // A link belongs to the provider it was made or pasted for, ours or not.
    // Kept across a switch, it would be saved against the new provider: a
    // Zoom link on a Meet meeting, or the Zoom meeting we are about to cancel
    // passed off as the link someone pasted. A provider that makes the
    // meeting fills its own in; a link to paste starts empty.
    if (next !== provider) onUrlChange("");
  };

  /** One option: a button in the row, the chosen one raised. */
  const option = (
    key: string,
    value: ConferenceProvider,
    label: string,
    glyph: React.ReactNode,
    opts: { off?: boolean; hint?: string } = {},
  ) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={provider === value}
      disabled={disabled || opts.off}
      title={opts.hint}
      onClick={() => pick(value)}
      className={cn(
        segmentedItem(provider === value),
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {glyph}
      {label}
    </button>
  );

  return (
    <div className="grid gap-1.5">
      <span id="event-conference-label" className="text-sm leading-none font-medium select-none">
        Video call
      </span>
      {/*
        One button per choice, not a menu (Jack asked for this on Meetings'
        Video calls bar, and it holds here too): every option is one click
        and you see what's chosen. A provider the organization hasn't
        connected shows greyed with why; connecting happens on Meetings,
        because it leaves the page and this form would be lost.
      */}
      <div
        role="radiogroup"
        aria-labelledby="event-conference-label"
        className={cn(segmentedTrack, "h-auto flex-wrap rounded-[22px]")}
      >
        {option("none", ConferenceProvider.NONE, "None", <X aria-hidden="true" />)}
        {rows.map((c) => {
          const value = PROVIDER_OF[c.provider];
          if (!value || (!c.connected && !c.available)) return null;
          return option(
            c.provider,
            value,
            c.label,
            <MeetingLogo provider={c.provider} className={cn(!c.connected && "opacity-60")} />,
            {
              off: !c.connected,
              hint: c.connected
                ? undefined
                : c.needsReauth
                  ? "Needs reconnecting under Video calls in Meetings"
                  : "Connect it under Video calls in Meetings",
            },
          );
        })}
        {option("paste", ConferenceProvider.OTHER, "Paste link", <Link2 aria-hidden="true" />)}
      </div>

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
          {managed && conferenceUrl ? "Link ready." : "Link made on save."}
        </p>
      )}
    </div>
  );
}
