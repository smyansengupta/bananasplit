import type { ConferenceDialIn } from "@/server/conference/types";

/**
 * Reads `Event.conferenceDialIn` (docs/features/meetings.md).
 *
 * The column is JSON: whatever shape the provider's answer had when the sync
 * job stored it. Reading it back must not take the page down, so anything that
 * is not a list is empty, and an entry without a text number is dropped. A
 * country or PIN that is not text is left out rather than shown.
 */
export function parseDialIn(value: unknown): ConferenceDialIn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ConferenceDialIn[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const { country, number, pin } = entry as Record<string, unknown>;
    if (typeof number !== "string" || number.trim() === "") return [];
    return [
      {
        country: typeof country === "string" && country !== "" ? country : null,
        number,
        pin: typeof pin === "string" && pin !== "" ? pin : null,
      },
    ];
  });
}
