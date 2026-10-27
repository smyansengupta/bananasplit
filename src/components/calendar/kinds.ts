import type { CalendarSyncState, EventVisibility, RSVPStatus } from "@/generated/prisma/enums";

import { tagStyle } from "@/lib/calendar/tags";

/**
 * Labels for an event's visibility, its Google sync state and an RSVP.
 * Client-safe.
 *
 * The event TYPES that used to live here are the organization's own now
 * (src/lib/calendar/tags.ts): a fixed list of one club's words was the
 * wrong shape for everyone else.
 */

/** A chip's colour: its type's, or the primary for a task's due date. */
export function itemStyle(item: {
  tag?: { color: string | null } | null;
  task?: unknown;
}): React.CSSProperties {
  return item.task ? { ["--kind" as string]: "var(--primary)" } : tagStyle(item.tag?.color);
}

export const VISIBILITY_META: Record<EventVisibility, { label: string; hint: string }> = {
  PUBLIC: { label: "Public", hint: "On the website and the public Google Calendar" },
  INTERNAL: { label: "Internal", hint: "Board and members only" },
};

export const SYNC_META: Record<CalendarSyncState, { label: string; hint: string }> = {
  NOT_APPLICABLE: { label: "Not on Google", hint: "Not mirrored to Google Calendar" },
  PENDING: { label: "Syncing", hint: "Waiting to reach Google Calendar" },
  SYNCED: { label: "On Google", hint: "Mirrored to Google Calendar" },
  FAILED: { label: "Sync failed", hint: "Google Calendar did not accept the last change" },
};

export const RSVP_META: Record<RSVPStatus, { label: string; short: string }> = {
  PENDING: { label: "Not answered", short: "Invited" },
  YES: { label: "Going", short: "Going" },
  NO: { label: "Not going", short: "Not going" },
  MAYBE: { label: "Maybe", short: "Maybe" },
};
