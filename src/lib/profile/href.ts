/**
 * Links into the Profiles section, for every section that shows a person
 * (the org chart side panel, task assignees, database person columns).
 * Pure and client-safe.
 */

export type ProfileSection =
  | "details"
  | "photo"
  | "links"
  | "theme"
  | "availability"
  | "notifications"
  | "calendar";

/** The signed-in user's own profile, optionally at one section. */
export function profileHref(orgSlug: string, section?: ProfileSection): string {
  const base = `/app/${encodeURIComponent(orgSlug)}/profile`;
  return section ? `${base}#${section}` : base;
}

/** The people directory of an org. */
export function peopleHref(orgSlug: string, options: { page?: number; q?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  const query = params.toString();
  return `/app/${encodeURIComponent(orgSlug)}/people${query ? `?${query}` : ""}`;
}

/** One member's page in an org. */
export function personHref(orgSlug: string, userId: string): string {
  return `/app/${encodeURIComponent(orgSlug)}/people/${encodeURIComponent(userId)}`;
}

/**
 * The tasks table filtered to one person's open work.
 *
 * Spec order: the tasks table filters by ?assignee={id} today. When Tasks
 * (Phase 6) ships the single-owner model it switches this one function to
 * ?view=table&owner={id}&status=open (plan, Phase 2 "People pages").
 */
export function personTasksHref(orgSlug: string, userId: string): string {
  const params = new URLSearchParams({ view: "table", assignee: userId });
  return `/app/${encodeURIComponent(orgSlug)}/tasks?${params.toString()}`;
}
