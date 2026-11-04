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

/** An outreach plan: Outreach with its card open. */
export function crmPlanHref(orgSlug: string, type: "sequence" | "campaign", id: string): string {
  return hrefWithOpen(`${crmBase(orgSlug)}/outreach`, "", { kind: "plan", type, id });
}

/** A pipeline: Deals as a board, filtered to it. */
export function crmPipelineHref(orgSlug: string, pipelineId: string): string {
  return `${crmBase(orgSlug)}/deals?pipeline=${encodeURIComponent(pipelineId)}&view=board`;
}
