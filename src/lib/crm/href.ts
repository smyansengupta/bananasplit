import { hrefWithOpen } from "./overlay";

/**
 * Links into the CRM (src/app/app/[orgSlug]/crm). One place, so a record's
 * page moves without hunting for hand-built paths.
 *
 * A person, company or deal no longer has a page of its own: it opens as a
 * card over its list (?open=, src/lib/crm/overlay.ts). Inside the CRM a row
 * sets `open` on the page you're on instead (useCrmOpen); these full links
 * are for everywhere else (search, notifications, Databases, reports).
 */

export type CrmTargetKind = "person" | "company" | "deal";

export function crmBase(orgSlug: string): string {
  return `/app/${orgSlug}/crm`;
}

/** A person, company or deal: its list with its card open. */
export function crmRecordHref(orgSlug: string, kind: CrmTargetKind, id: string): string {
  const base = crmBase(orgSlug);
  if (kind === "person") return hrefWithOpen(`${base}/people`, "", { kind: "person", id });
  if (kind === "company")
    return hrefWithOpen(`${base}/people`, "view=companies", { kind: "company", id });
  return hrefWithOpen(`${base}/deals`, "", { kind: "deal", id });
}

/** Today, optionally filtered to one group (Replies, Due today, To approve, Calls). */
export function crmTodayHref(
  orgSlug: string,
  show?: "replies" | "due" | "approve" | "calls",
): string {
  const base = crmBase(orgSlug);
  return show ? `${base}?show=${show}` : base;
}

/** What waits for a member's OK (suggestions, drafts, duplicates): Today's To approve. */
export function crmApprovalsHref(orgSlug: string): string {
  return crmTodayHref(orgSlug, "approve");
}

/** People, or Companies, optionally on one list (`?list=`: a built-in one or a saved list's id). */
export function crmPeopleHref(
  orgSlug: string,
  options: { companies?: boolean; list?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (options.companies) params.set("view", "companies");
  if (options.list) params.set("list", options.list);
  const qs = params.toString();
  return `${crmBase(orgSlug)}/people${qs ? `?${qs}` : ""}`;
}

/** The New card for a person, company or deal, over the list it belongs to. */
export function crmNewHref(orgSlug: string, what: "person" | "company" | "deal"): string {
  const base = crmBase(orgSlug);
  if (what === "deal") return hrefWithOpen(`${base}/deals`, "", { kind: "new", what });
  if (what === "company")
    return hrefWithOpen(`${base}/people`, "view=companies", { kind: "new", what });
  return hrefWithOpen(`${base}/people`, "", { kind: "new", what });
}

/** Every deal. */
export function crmDealsHref(orgSlug: string): string {
  return `${crmBase(orgSlug)}/deals`;
}

/** CRM settings, on the section that suits the viewer (a section's own link: settings-sections.ts). */
export function crmSettingsHomeHref(orgSlug: string): string {
  return `${crmBase(orgSlug)}/settings`;
}

/** An outreach plan: Outreach with its card open. */
export function crmPlanHref(orgSlug: string, type: "sequence" | "campaign", id: string): string {
  return hrefWithOpen(`${crmBase(orgSlug)}/outreach`, "", { kind: "plan", type, id });
}

/** A pipeline: Deals as a board, filtered to it. */
export function crmPipelineHref(orgSlug: string, pipelineId: string): string {
  return `${crmBase(orgSlug)}/deals?pipeline=${encodeURIComponent(pipelineId)}&view=board`;
}
