/**
 * Links into the CRM (src/app/app/[orgSlug]/crm). One place, so a record's
 * page moves without hunting for hand-built paths.
 */

export type CrmTargetKind = "person" | "company" | "deal";

export function crmBase(orgSlug: string): string {
  return `/app/${orgSlug}/crm`;
}

/** A person's, company's or pipeline item's own page. */
export function crmRecordHref(orgSlug: string, kind: CrmTargetKind, id: string): string {
  const base = crmBase(orgSlug);
  if (kind === "person") return `${base}/people/${id}`;
  if (kind === "company") return `${base}/companies/${id}`;
  return `${base}/items/${id}`;
}

/** A pipeline's board (or table with ?view=table). */
export function crmPipelineHref(orgSlug: string, pipelineId: string): string {
  return `${crmBase(orgSlug)}/pipelines/${pipelineId}`;
}
