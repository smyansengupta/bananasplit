import { hrefWithOpen } from "./overlay";

/**
 * Links into the CRM (src/app/app/[orgSlug]/crm). One place, so a record's
 * page moves without hunting for hand-built paths.
 *
 * A person, company or deal no longer has a page of its own: it opens as a
 * card over its list (?open=, src/lib/crm/overlay.ts). Inside the CRM a row
 * sets `open` on the page you're on instead (useCrmOpen); these full links
 * are for everywhere else (search, notifications, Databases, reports).
 *
 * The CRM is two tabs, Today and People (docs/features/crm.md, "One list"):
 * deals are People's Board view, and follow-up series live in CRM settings
 * > Automations.
 */

export type CrmTargetKind = "person" | "company" | "deal";

export function crmBase(orgSlug: string): string {
  return `/app/${orgSlug}/crm`;
}

/** A person, company or deal: its list (a deal: People's board) with its card open. */
export function crmRecordHref(orgSlug: string, kind: CrmTargetKind, id: string): string {
  const base = crmBase(orgSlug);
  if (kind === "person") return hrefWithOpen(`${base}/people`, "", { kind: "person", id });
  if (kind === "company")
    return hrefWithOpen(`${base}/people`, "view=companies", { kind: "company", id });
  return hrefWithOpen(`${base}/people`, "view=board", { kind: "deal", id });
}

/** Deals: People as a board (one pipeline's, when given). */
export function crmDealsHref(orgSlug: string, pipelineId?: string | null): string {
  const base = `${crmBase(orgSlug)}/people?view=board`;
  return pipelineId ? `${base}&pipeline=${encodeURIComponent(pipelineId)}` : base;
}

/** A follow-up series or a split list: CRM settings > Automations with its card open. */
export function crmPlanHref(orgSlug: string, type: "sequence" | "campaign", id: string): string {
  return hrefWithOpen(`${crmBase(orgSlug)}/settings/automations`, "", { kind: "plan", type, id });
}

/** A pipeline: People as a board, filtered to it. */
export function crmPipelineHref(orgSlug: string, pipelineId: string): string {
  return crmDealsHref(orgSlug, pipelineId);
}
