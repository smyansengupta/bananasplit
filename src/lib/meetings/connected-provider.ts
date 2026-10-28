import { ConferenceProvider } from "@/generated/prisma/enums";

/**
 * Which video call a new online meeting starts on (docs/features/meetings.md).
 *
 * The connections are read in terms of the integration (`GOOGLE_MEET`), and a
 * meeting stores the provider it is made with (`MEET`). This is the one table
 * between the two, shared by the picker that draws them and the form that
 * chooses one for you. It is not `connectable()` in server/conference, which
 * reads the same rows but cannot be imported by a client component.
 */
export const CONFERENCE_PROVIDER_OF: Record<string, ConferenceProvider> = {
  GOOGLE_MEET: ConferenceProvider.MEET,
  ZOOM: ConferenceProvider.ZOOM,
  MICROSOFT_TEAMS: ConferenceProvider.TEAMS,
};

/**
 * The first provider the organization has connected, in the order the
 * Meetings page lists them, or null when none is (or the connections have not
 * loaded yet). Connected means ready to make a meeting right now: one that
 * needs reconnecting is not.
 */
export function firstConnectedProvider(
  connections: readonly { provider: string; connected: boolean }[] | null,
): ConferenceProvider | null {
  for (const c of connections ?? []) {
    const provider = CONFERENCE_PROVIDER_OF[c.provider];
    if (c.connected && provider) return provider;
  }
  return null;
}
