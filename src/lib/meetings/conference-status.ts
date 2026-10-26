// The enums entry, not the client: the join card (a client component) imports
// this module, and must stay free of server code.
import type { CalendarSyncState, ConferenceProvider } from "@/generated/prisma/enums";

/** What a card calls each kind of call. */
export const CONFERENCE_LABELS: Record<ConferenceProvider, string> = {
  NONE: "",
  MEET: "Google Meet",
  ZOOM: "Zoom",
  TEAMS: "Microsoft Teams",
  OTHER: "Online",
};

/**
 * What a meeting's page says about its video call (docs/features/meetings.md).
 *
 * `none`: nothing to say (no call, or a call with no link and no job working
 * on one). `ready`: the link is there. `pending`: the conference-sync job is
 * making it. `failed`: the job gave up. The page never throws a meeting away
 * over this: a failed row keeps whatever link it had.
 */
export type ConferenceStatus =
  | { kind: "none" }
  | { kind: "ready" }
  | { kind: "pending"; line: string }
  | { kind: "failed"; line: string; reason: string | null };

/**
 * The state of an event's video call.
 *
 * `reason` is the stored, already sanitized `conferenceSyncError`, and only
 * for someone who can edit the event: it can name an account or a setting
 * that is not for everyone, and only people who can fix it need it.
 *
 * A link someone pasted is `ready` whatever the sync state says. The job
 * never makes or changes one, so a PENDING or FAILED left on the row from
 * before the paste is stale, and offering to "try again" would promise
 * something we will not do.
 */
export function conferenceStatus(
  e: {
    conferenceProvider: ConferenceProvider;
    conferenceManaged: boolean;
    conferenceUrl: string | null;
    conferenceSyncState: CalendarSyncState;
    conferenceSyncError: string | null;
  },
  canEdit: boolean,
): ConferenceStatus {
  if (e.conferenceProvider === "NONE") return { kind: "none" };
  const hasLink = Boolean(e.conferenceUrl);
  const pasted = hasLink && !e.conferenceManaged;
  // OTHER is only ever a pasted link: there is no provider to make one.
  if (pasted || e.conferenceProvider === "OTHER")
    return hasLink ? { kind: "ready" } : { kind: "none" };

  const label = CONFERENCE_LABELS[e.conferenceProvider];
  if (e.conferenceSyncState === "PENDING") {
    return { kind: "pending", line: `Getting the ${label} link…` };
  }
  if (e.conferenceSyncState === "FAILED") {
    return {
      kind: "failed",
      line: `Couldn't make the ${label} meeting.`,
      reason: canEdit ? e.conferenceSyncError : null,
    };
  }
  return hasLink ? { kind: "ready" } : { kind: "none" };
}
