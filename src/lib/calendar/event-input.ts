import { ConferenceProvider } from "@/generated/prisma/enums";
import { isAllowedJoinUrl, providerForConference } from "@/server/conference/providers";

import { allDayInstants, parseDateKey } from "./dates";

/** Validation shared by the calendar actions (kept out of the "use server" module). */

/**
 * The meeting link a save may carry, per provider (docs/features/meetings.md).
 *
 * - `None` requires the field to be empty.
 * - Meet, Zoom and Teams with an empty link mean "make the meeting for me":
 *   the conference-sync job fills it in after the save. A link that IS there
 *   (one we made, or one pasted before we could make them) must be on a host
 *   that provider owns: the same `isAllowedJoinUrl` and host list the job
 *   checks a provider's answer against, so the two rules cannot drift apart.
 * - `Other` has nothing for us to call, so it needs a link, any https one.
 */
export function conferenceUrlError(
  provider: ConferenceProvider,
  url: string | null | undefined,
): string | null {
  const trimmed = url?.trim() || "";
  if (provider === ConferenceProvider.NONE) {
    return trimmed ? "Remove the link or choose a conferencing provider." : null;
  }
  const def = providerForConference(provider);
  if (!trimmed) return def ? null : "Paste a meeting link for this provider.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (parsed.protocol !== "https:") return "Meeting links must use https.";
  if (def && !isAllowedJoinUrl(trimmed, def.joinHosts)) {
    return `Expected a ${def.joinHosts.join(" or ")} link.`;
  }
  return null;
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
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: "Enter a valid start and end time." };
  if (end < start) return { error: "End time must be after the start time." };
  return { startsAt: start, endsAt: end, allDay: false };
}
