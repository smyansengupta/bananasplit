import { ConferenceProvider } from "@/generated/prisma/enums";

import { allDayInstants, parseDateKey } from "./dates";

/** Validation shared by the calendar actions (kept out of the "use server" module). */

/**
 * Paste-only conference links, per provider (no generated links in v1).
 * `Other` accepts any https URL; `None` requires the field to be empty.
 */
export function conferenceUrlError(
  provider: ConferenceProvider,
  url: string | null | undefined,
): string | null {
  const trimmed = url?.trim() || "";
  if (provider === ConferenceProvider.NONE) {
    return trimmed ? "Remove the link or choose a conferencing provider." : null;
  }
  if (!trimmed) return "Paste a meeting link for this provider.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (parsed.protocol !== "https:") return "Meeting links must use https.";
  switch (provider) {
    case ConferenceProvider.MEET:
      return parsed.hostname === "meet.google.com" ? null : "Expected a meet.google.com link.";
    case ConferenceProvider.ZOOM:
      return parsed.hostname === "zoom.us" || parsed.hostname.endsWith(".zoom.us")
        ? null
        : "Expected a zoom.us link.";
    case ConferenceProvider.TEAMS:
      return parsed.hostname === "teams.microsoft.com"
        ? null
        : "Expected a teams.microsoft.com link.";
    default:
      return null;
  }
}

/** Stored instants from the form's values; null when they don't parse. */
export function resolveTimes(
  allDay: boolean,
  startsAt: string,
  endsAt: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date; allDay: boolean } | { error: string } {
  if (allDay) {
    const firstDay = startsAt.slice(0, 10);
    const lastDay = endsAt.slice(0, 10);
    if (!parseDateKey(firstDay) || !parseDateKey(lastDay)) return { error: "Enter valid dates." };
    if (lastDay < firstDay) return { error: "The last day must be on or after the first day." };
    return { ...allDayInstants(firstDay, lastDay, timeZone), allDay: true };
  }
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return { error: "Enter a valid start and end time." };
  if (end < start) return { error: "End time must be after the start time." };
  return { startsAt: start, endsAt: end, allDay: false };
}
