/**
 * The organization's meeting types (OrgSettings.eventTypes): named and
 * coloured on onboarding's meetings step, picked on a meeting
 * (Event.meetingType, by name), and drawn in that colour on the calendar.
 * Client-safe.
 */

export interface MeetingType {
  name: string;
  /** "#rrggbb". */
  color: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The saved list, or [] when there is none or it isn't a list of types. */
export function parseMeetingTypes(raw: unknown): MeetingType[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingType[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name, color } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || typeof color !== "string" || !HEX.test(color)) {
      continue;
    }
    out.push({ name: name.trim().slice(0, 40), color });
  }
  return out;
}

/** The colour a meeting of type `name` is drawn in, or null (no type, or one no longer in the list). */
export function meetingTypeColor(
  types: readonly MeetingType[],
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const key = name.toLowerCase();
  return types.find((t) => t.name.toLowerCase() === key)?.color ?? null;
}
