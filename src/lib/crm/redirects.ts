import { crmApprovalsHref, crmBase, crmNewHref, crmPipelineHref, crmPlanHref } from "./href";
import { formatOpen, hrefWithOpen, OPEN_PARAM, parseOpen } from "./overlay";

/**
 * Where the old Deals and Outreach URLs land now (docs/features/crm.md,
 * "One list"): the CRM is Today and People. Deals are People's Board view;
 * follow-up series and split lists are in CRM settings > Automations; one
 * email to many opens over People; templates and your mail are in Settings.
 * Pure, so the redirect pages and the tests agree.
 */

type Search = Readonly<Record<string, string | readonly string[] | undefined>>;

function one(sp: Search, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

/** The deal filters Deals had, in the order People writes them. */
const DEAL_PARAMS = ["pipeline", "stage", "owner", "type", "show", "q", "tab", OPEN_PARAM] as const;

/** /crm/deals?pipeline&stage&owner&type&show&q&open: People as a board with the same filters and card. */
export function dealsRedirectHref(orgSlug: string, sp: Search): string {
  const out = new URLSearchParams({ view: "board" });
  for (const key of DEAL_PARAMS) {
    const v = one(sp, key);
    if (!v) continue;
    if (key === OPEN_PARAM) {
      const open = parseOpen(v);
      if (open) out.set(OPEN_PARAM, formatOpen(open));
    } else out.set(key, v);
  }
  return `${crmBase(orgSlug)}/people?${out.toString()}`;
}

/** Which old Outreach page this is. */
export type OutreachFrom = "outreach" | "bulk" | "mail" | "sequences" | "campaigns";

/**
 * Where an old Outreach URL goes: a plan card with an id opens over
 * Settings > Automations (where follow-up series live), a new split list
 * too; one email to many opens over People with its list (`?to=`);
 * Templates and Your mail go to their Settings sections; the lists of
 * sequences and campaigns go to Automations; everything else to People.
 */
export function outreachRedirectHref(orgSlug: string, from: OutreachFrom, sp: Search = {}): string {
  const base = crmBase(orgSlug);
  const automations = `${base}/settings/automations`;
  const people = `${base}/people`;
  const emailTo = (list: string | null) =>
    hrefWithOpen(people, list ? { to: list } : {}, { kind: "plan", type: "email", id: null });
  if (from === "bulk") return emailTo(one(sp, "list"));
  if (from === "mail") return `${base}/settings/you`;
  if (from === "sequences" || from === "campaigns") return automations;
  const open = parseOpen(one(sp, OPEN_PARAM));
  if (open?.kind === "plan") {
    if (open.id) return crmPlanHref(orgSlug, open.type, open.id);
    if (open.type === "split") return hrefWithOpen(automations, {}, open);
    return emailTo(one(sp, "to") ?? one(sp, "list"));
  }
  if (open) return hrefWithOpen(people, {}, open);
  const view = one(sp, "view");
  if (view === "templates") return `${base}/settings/you#templates`;
  if (view === "mail") return `${base}/settings/you`;
  return people;
}

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
