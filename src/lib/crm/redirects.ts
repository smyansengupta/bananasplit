import { crmApprovalsHref, crmNewHref, crmPipelineHref } from "./href";

/**
 * Where the CRM's retired pages send old links (pure, so the redirects are
 * tested without a request). Each keeps what the old URL asked for.
 */

type Search = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(v: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === "string" ? value : undefined;
}

/** /crm/queue (Review): Today's To approve. */
export function queueRedirect(orgSlug: string): string {
  return crmApprovalsHref(orgSlug);
}

/** /crm/items/new (New item): the New deal card. */
export function newItemRedirect(orgSlug: string): string {
  return crmNewHref(orgSlug, "deal");
}

/**
 * /crm/pipelines/<id>: Deals filtered to the pipeline, every other param
 * kept; ?new=1 (the old board's New item) opens the New deal card.
 */
export function pipelineRedirect(orgSlug: string, pipelineId: string, sp: Search): string {
  const target = crmPipelineHref(orgSlug, pipelineId);
  const q = target.indexOf("?");
  const path = q === -1 ? target : target.slice(0, q);
  const next = new URLSearchParams(q === -1 ? "" : target.slice(q + 1));
  for (const [k, raw] of Object.entries(sp)) {
    const v = first(raw);
    if (v === undefined || next.has(k)) continue;
    if (k === "new") {
      if (v === "1" && !first(sp.open)) next.set("open", "new:deal");
      continue;
    }
    next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}
