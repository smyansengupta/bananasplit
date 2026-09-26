import type { CalendarSyncState, EventKind, EventVisibility, RSVPStatus } from "@/generated/prisma/enums";

/**
 * Labels and colour variables for the calendar's event kinds, visibility,
 * Google sync state and RSVP. Client-safe.
 *
 * KIND COLOURS ARE THEME TOKENS, not fixed values. Each kind names a CSS
 * variable, so an org's theme restyles the calendar with everything else
 * (Settings > Theme). --chart-1..5 are the derived categorical palette: it
 * is checked per theme for a lightness band, a chroma floor, colour-blind
 * separation between adjacent slots and 3:1 against both surfaces (see
 * src/lib/theme/chart.ts), which is exactly the guarantee a row of event
 * kinds needs. "Other" is the uncategorised one and takes the neutral.
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
  WORKSHOP: { label: "Workshop", token: "--chart-1" },
  INFO_SESSION: { label: "Info session", token: "--chart-2" },
  HACKATHON: { label: "Hackathon", token: "--chart-3" },
  SOCIAL: { label: "Social", token: "--chart-4" },
  BOARD_MEETING: { label: "Board meeting", token: "--chart-5" },
  OTHER: { label: "Other", token: "--muted-foreground" },
};

export const KIND_ORDER: EventKind[] = ["WORKSHOP", "INFO_SESSION", "HACKATHON", "SOCIAL", "BOARD_MEETING", "OTHER"];

/**
 * The style object that puts a kind's colour on an element as `--kind`.
 * Everything in calendar.css paints from that one variable, so a chip, a
 * dot, a bar and a time-grid block all follow the same token.
 */
export function kindStyle(kind: EventKind): React.CSSProperties {
  return { ["--kind" as string]: `var(${KIND_META[kind].token})` };
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
