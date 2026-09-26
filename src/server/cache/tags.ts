/**
 * Cache tags, in the one grammar every phase uses (D8):
 *
 *   org:{orgId}:{area}[:{id}]
 *
 * Tags are built ONLY here, never as string literals elsewhere, so the tag a
 * cached loader is stored under and the tag a service invalidates can never
 * drift apart. A tag exists only for an unstable_cache loader; per-request
 * reads (React cache(), RLS-scoped pages) need none.
 *
 * Areas and their loaders:
 *   orgchart       getPublishedOrgChart (src/server/org-chart/queries.ts)
 *   reports        the Phase 5 report loaders, optionally per report id
 *   public-events  the public events feed (Phase 7) and the event service
 *   theme          the org theme, if Phase 8 moves it into a cached loader
 *   databases      database definitions, optionally per database key
 *   members        the member picker / roster, if cached
 */

export const TAG_AREAS = {
  orgChart: "orgchart",
  reports: "reports",
  publicEvents: "public-events",
  theme: "theme",
  databases: "databases",
  members: "members",
} as const;

export type TagArea = (typeof TAG_AREAS)[keyof typeof TAG_AREAS];

/** Next.js ignores tags longer than 256 characters. */
const MAX_TAG_LENGTH = 256;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function segment(name: string, value: string): string {
  if (!value || !SEGMENT.test(value)) {
    throw new TypeError(`cache tag ${name} must match ${SEGMENT} (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** Builds `org:{orgId}:{area}[:{id}]`. Exported for tests; use the helpers. */
export function orgTag(orgId: string, area: TagArea, id?: string): string {
  const parts = ["org", segment("orgId", orgId), area];
  if (id !== undefined) parts.push(segment("id", id));
  const tag = parts.join(":");
  if (tag.length > MAX_TAG_LENGTH) throw new TypeError("cache tag too long");
  return tag;
}

/** The published org chart of an org. */
export function orgChart(orgId: string): string {
  return orgTag(orgId, TAG_AREAS.orgChart);
}

/** All reports of an org, or one report. */
export function reports(orgId: string, reportId?: string): string {
  return orgTag(orgId, TAG_AREAS.reports, reportId);
}

/** The public events feed of an org. */
export function publicEvents(orgId: string): string {
  return orgTag(orgId, TAG_AREAS.publicEvents);
}

/** The org theme. */
export function theme(orgId: string): string {
  return orgTag(orgId, TAG_AREAS.theme);
}

/** All database definitions of an org, or one database (by key). */
export function databases(orgId: string, dbKey?: string): string {
  return orgTag(orgId, TAG_AREAS.databases, dbKey);
}

/** The member list of an org. */
export function members(orgId: string): string {
  return orgTag(orgId, TAG_AREAS.members);
}

/** The helpers as one namespace: `tags.orgChart(orgId)`. */
export const tags = { orgChart, reports, publicEvents, theme, databases, members } as const;

/** True for a string in the tag grammar (for tests and invalidate()). */
export function isOrgTag(tag: string): boolean {
  const [prefix, orgId = "", area = "", id, ...rest] = tag.split(":");
  if (prefix !== "org" || rest.length > 0 || !SEGMENT.test(orgId)) return false;
  if (!(Object.values(TAG_AREAS) as string[]).includes(area)) return false;
  return id === undefined || SEGMENT.test(id);
}
