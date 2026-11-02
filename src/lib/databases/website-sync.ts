import type { DatabaseKind } from "@/generated/prisma/enums";

/**
 * Built-in databases whose rows only ever come from the website data sync
 * (the SUPABASE_SOURCE integration). Ballots: the website's polls and
 * votes; nothing in Bananasplit adds either. The others (sessions,
 * check-ins, sign-ups, people) are also filled by hand, by QR check-in, by
 * CSV and by forms, so they stay.
 */
export const WEBSITE_ONLY_KINDS: readonly DatabaseKind[] = ["BALLOTS"];

/**
 * The databases to list on Databases home: without a connected website sync,
 * the ones only it fills are left out (what it left behind is stale and
 * nothing here updates it). Their pages still open by URL; nothing is
 * deleted.
 */
export function withoutStaleWebsiteData<T extends { kind: DatabaseKind }>(
  databases: readonly T[],
  websiteSyncConnected: boolean,
): T[] {
  if (websiteSyncConnected) return [...databases];
  return databases.filter((d) => !WEBSITE_ONLY_KINDS.includes(d.kind));
}
