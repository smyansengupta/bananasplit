import type {
  CalendarSyncState,
  EventKind,
  EventVisibility,
  RSVPStatus,
} from "@/generated/prisma/enums";

import { tagToken } from "@/lib/tag-colors";

/**
 * Labels and colour variables for the calendar's event kinds, visibility,
 * Google sync state and RSVP. Client-safe.
 *
 * KIND COLOURS COME FROM THE TAG PALETTE (src/lib/tag-colors.ts), not
 * from the org's theme. They were the derived chart slots, which meant a
 * club's kinds changed colour whenever it changed theme and had almost
 * none at all under a monochrome one. A kind is a label, not a data
 * series: it keeps its colour. "Other" is the uncategorised one and takes
 * the neutral. The chart slots are untouched and still belong to charts.
 *
 * Colour is never the only cue: every chip carries the kind in its
 * accessible name, and every tile, row and popover names it in text.
 */

export interface KindMeta {
  label: string;
  /** The CSS variable carrying this kind's colour. */
  token: string;
}

export const KIND_META: Record<EventKind, KindMeta> = {
  WORKSHOP: { label: "Workshop", token: tagToken("navy") },
  INFO_SESSION: { label: "Info session", token: tagToken("rust") },
  HACKATHON: { label: "Hackathon", token: tagToken("forest") },
  SOCIAL: { label: "Social", token: tagToken("ochre") },
  BOARD_MEETING: { label: "Board meeting", token: tagToken("plum") },
  OTHER: { label: "Other", token: "--muted-foreground" },
};

export const KIND_ORDER: EventKind[] = [
  "WORKSHOP",
  "INFO_SESSION",
  "HACKATHON",
  "SOCIAL",
  "BOARD_MEETING",
  "OTHER",
];

/**
 * The style object that puts a kind's colour on an element as `--kind`.
 * Everything in calendar.css paints from that one variable, so a chip, a
 * dot, a bar and a time-grid block all follow the same token.
 */
export function kindStyle(kind: EventKind): React.CSSProperties {
  return { ["--kind" as string]: `var(${KIND_META[kind].token})` };
}

/** A chip's colour: its meeting type's, else its kind's, or the primary for a task's due date. */
export function itemStyle(item: {
  kind: EventKind;
  typeColor?: string | null;
  task?: unknown;
}): React.CSSProperties {
  if (item.task) return { ["--kind" as string]: "var(--primary)" };
  return item.typeColor ? { ["--kind" as string]: item.typeColor } : kindStyle(item.kind);
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
