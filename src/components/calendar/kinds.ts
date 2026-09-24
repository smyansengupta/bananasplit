import type { CalendarSyncState, EventKind, EventVisibility } from "@/generated/prisma/enums";

/**
 * Labels and colors for the calendar's event kinds, visibility and Google
 * sync state. Client-safe. Kind colors are a small categorical palette that
 * reads on light and dark backgrounds; color is never the only cue (every
 * chip and badge names its kind in text).
 */

export const KIND_META: Record<EventKind, { label: string; color: string }> = {
  WORKSHOP: { label: "Workshop", color: "oklch(0.56 0.13 250)" },
  INFO_SESSION: { label: "Info session", color: "oklch(0.6 0.15 40)" },
  HACKATHON: { label: "Hackathon", color: "oklch(0.52 0.16 300)" },
  SOCIAL: { label: "Social", color: "oklch(0.55 0.12 160)" },
  BOARD_MEETING: { label: "Board meeting", color: "oklch(0.5 0.03 260)" },
  OTHER: { label: "Other", color: "oklch(0.52 0.04 90)" },
};

export const KIND_ORDER: EventKind[] = ["WORKSHOP", "INFO_SESSION", "HACKATHON", "SOCIAL", "BOARD_MEETING", "OTHER"];

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
