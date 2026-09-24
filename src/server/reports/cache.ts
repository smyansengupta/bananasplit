import { unstable_cache } from "next/cache";

import { reports as reportsTag } from "@/server/cache/tags";
import { withSystemOrgTx } from "@/server/db/context";

import { REPORTS } from "./registry";
import type { ReportId, ReportPayloads, ReportResult, ReportTier } from "./types";

/**
 * The cached report loaders (Phase 5, contract 'Caching model').
 *
 * getReport(id, key) wraps unstable_cache around computeReport with
 *   keyParts ['report', id, REPORT_CACHE_VERSION]
 *   tags     [org:{orgId}:reports, org:{orgId}:reports:{id}]  (tags.ts)
 *   revalidate OrgSettings.reportsRefreshSeconds
 * and calls it with positional primitives in a fixed order:
 *   id, orgId, tier, from, to, tz, dataVersion, settingsStamp
 * unstable_cache keys on (function source, keyParts, JSON of the arguments),
 * so:
 * - two orgs, or two tiers, never share an entry (owner-only ballot counts
 *   are never served to a member);
 * - presets are resolved to explicit org-local dates first, so "this term"
 *   and the same custom dates share one entry, and "all time" is ("", "");
 * - OrgSettings.reportsDataVersion (bumped with every data write, see
 *   data-version.ts) changes the key even if a tag invalidation was missed;
 * - OrgSettings.updatedAt (settingsStamp) changes the key when an admin
 *   edits milestones, the lapsed threshold or ballot privacy.
 *
 * computeReport opens its OWN withSystemOrgTx(orgId) and passes every input
 * explicitly: a background revalidation runs outside the request, with no
 * transaction, cookies or headers. AUTHORIZE FIRST: the caller has checked
 * membership, derived the tier and checked visibility (visibility.ts).
 */

export const REPORT_CACHE_VERSION = "v1";

/** reportsRefreshSeconds is clamped to this window (unstable_cache refuses 0). */
export const MIN_REFRESH_SECONDS = 30;
export const MAX_REFRESH_SECONDS = 86_400;

export interface ReportKey {
  orgId: string;
  tier: ReportTier;
  /** Org-local inclusive dates, or null for no bound. */
  from: string | null;
  to: string | null;
  tz: string;
  /** OrgSettings.reportsDataVersion. */
  dataVersion: number;
  /** OrgSettings.updatedAt as ISO, or "" when the org has no settings row. */
  settingsStamp: string;
}

export type ReportCacheArgs = [
  id: ReportId,
  orgId: string,
  tier: ReportTier,
  from: string,
  to: string,
  tz: string,
  dataVersion: number,
  settingsStamp: string,
];

/** The positional, primitive arguments the cached function is called with (its key). */
export function reportCacheArgs(id: ReportId, key: ReportKey): ReportCacheArgs {
  return [
    id,
    key.orgId,
    key.tier,
    key.from ?? "",
    key.to ?? "",
    key.tz,
    key.dataVersion,
    key.settingsStamp,
  ];
}

export function reportKeyParts(id: ReportId): string[] {
  return ["report", id, REPORT_CACHE_VERSION];
}

export function reportTags(orgId: string, id: ReportId): string[] {
  return [reportsTag(orgId), reportsTag(orgId, id)];
}

export function clampRefreshSeconds(seconds: number | null | undefined): number {
  const n = Number.isFinite(seconds) ? Math.round(seconds as number) : 300;
  return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, n));
}

/** Computes one report on the service path. Every input is an argument. */
export async function computeReport(...args: ReportCacheArgs): Promise<ReportResult> {
  const [id, orgId, tier, from, to, tz] = args;
  const definition = REPORTS[id];
  if (!definition) throw new TypeError(`unknown report ${String(id)}`);
  const data = await withSystemOrgTx<ReportPayloads[ReportId]>(orgId, ({ db }) =>
    definition.query(db, { orgId, tier, from: from || null, to: to || null, tz }),
  );
  return { id, computedAt: new Date().toISOString(), data };
}

function isMissingIncrementalCache(error: unknown): boolean {
  return (
    error instanceof Error &&
    /incrementalCache missing|static generation store missing/i.test(error.message)
  );
}

/** One report for `key`, from the cache or freshly computed. */
export async function getReport<Id extends ReportId>(
  id: Id,
  key: ReportKey,
  refreshSeconds: number,
): Promise<ReportResult<Id>> {
  const cached = unstable_cache(computeReport, reportKeyParts(id), {
    tags: reportTags(key.orgId, id),
    revalidate: clampRefreshSeconds(refreshSeconds),
  });
  const args = reportCacheArgs(id, key);
  try {
    return (await cached(...args)) as ReportResult<Id>;
  } catch (error) {
    // Outside a Next.js request (scripts, tests) there is no incremental cache.
    if (isMissingIncrementalCache(error)) return (await computeReport(...args)) as ReportResult<Id>;
    throw error;
  }
}
