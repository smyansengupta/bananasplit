/**
 * The CRM's overlay contract (docs/features/crm.md, "Redesign"): whatever
 * opens over a CRM page (a person, a company, a deal, Power hour, Done on
 * its own, Ask, New, a goal) is named by one search param, `?open=`, and
 * drawn as one kind of centered card. The page underneath keeps the rest of
 * its URL, so closing the card is removing `open`.
 *
 *   ?open=person:<id>    ?open=company:<id>    ?open=deal:<id>
 *   ?open=power          ?open=log             ?open=ask
 *   ?open=new:person     ?open=new:company     ?open=new:deal
 *   ?open=goal           ?open=goal:<id>
 *   ?open=merge:<idA>,<idB>   (two people, or two companies)
 *   ?open=merge:<id>          (pick the second one in the card)
 *   ?open=quote:<id>          (a quote or invoice, with every detail)
 *   ?open=plan:sequence:<id>    ?open=plan:campaign:<id>   (an outreach plan)
 *   ?open=plan:email     ?open=plan:split   (a new one-email or split-a-list plan)
 *
 * Pure, so the server (CrmOverlays) and the client (useCrmOpen) read and
 * write it the same way.
 */

export const OPEN_PARAM = "open";

export type CrmNewKind = "person" | "company" | "deal";

/**
 * A plan (docs/features/crm.md, "One list"): a follow-up series (a
 * sequence, timed steps) or a campaign (a list split among members, or one
 * email to everyone on it). `email` and `split` are new ones, not saved yet.
 */
export type CrmPlanType = "sequence" | "campaign";
export type CrmNewPlan = "email" | "split";

export type CrmOpen =
  | { kind: "person"; id: string }
  | { kind: "company"; id: string }
  | { kind: "deal"; id: string }
  | { kind: "power" }
  | { kind: "log" }
  | { kind: "ask" }
  | { kind: "new"; what: CrmNewKind }
  | { kind: "goal"; id: string | null }
  | { kind: "merge"; ids: [string, string] | [string] }
  | { kind: "quote"; id: string }
  | { kind: "plan"; type: CrmPlanType; id: string }
  | { kind: "plan"; type: CrmNewPlan; id: null };

export type CrmOpenKind = CrmOpen["kind"];

/** Record ids are cuids; anything else (a typo, a stray quote) opens nothing. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const NEW_KINDS: readonly CrmNewKind[] = ["person", "company", "deal"];
const PLAN_TYPES: readonly CrmPlanType[] = ["sequence", "campaign"];
const NEW_PLANS: readonly CrmNewPlan[] = ["email", "split"];

function parsePlan(rest: string | null): CrmOpen | null {
  if (!rest) return null;
  if ((NEW_PLANS as readonly string[]).includes(rest))
    return { kind: "plan", type: rest as CrmNewPlan, id: null };
  const colon = rest.indexOf(":");
  if (colon === -1) return null;
  const type = rest.slice(0, colon);
  const id = rest.slice(colon + 1);
  if (!(PLAN_TYPES as readonly string[]).includes(type) || !ID.test(id)) return null;
  return { kind: "plan", type: type as CrmPlanType, id };
}

/** `?open=` as a CrmOpen, or null when it's missing or names nothing we draw. */
export function parseOpen(raw: string | readonly string[] | null | undefined): CrmOpen | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const colon = text.indexOf(":");
  const head = colon === -1 ? text : text.slice(0, colon);
  const rest = colon === -1 ? null : text.slice(colon + 1);
  switch (head) {
    case "person":
    case "company":
    case "deal":
    case "quote":
      return rest && ID.test(rest) ? { kind: head, id: rest } : null;
    case "power":
    case "log":
    case "ask":
      return rest === null ? { kind: head } : null;
    case "new":
      return rest && (NEW_KINDS as readonly string[]).includes(rest)
        ? { kind: "new", what: rest as CrmNewKind }
        : null;
    case "goal":
      if (rest === null) return { kind: "goal", id: null };
      return ID.test(rest) ? { kind: "goal", id: rest } : null;
    case "merge": {
      const ids = (rest ?? "").split(",");
      // One id: the card asks for the second.
      if (ids.length === 1) return ID.test(ids[0]!) ? { kind: "merge", ids: [ids[0]!] } : null;
      if (ids.length !== 2) return null;
      const [a, b] = ids as [string, string];
      return ID.test(a) && ID.test(b) && a !== b ? { kind: "merge", ids: [a, b] } : null;
    }
    case "plan":
      return parsePlan(rest);
    default:
      return null;
  }
}

/** A CrmOpen as the `?open=` value. */
export function formatOpen(open: CrmOpen): string {
  switch (open.kind) {
    case "person":
    case "company":
    case "deal":
    case "quote":
      return `${open.kind}:${open.id}`;
    case "new":
      return `new:${open.what}`;
    case "goal":
      return open.id ? `goal:${open.id}` : "goal";
    case "merge":
      return `merge:${open.ids.join(",")}`;
    case "plan":
      return open.id ? `plan:${open.type}:${open.id}` : `plan:${open.type}`;
    default:
      return open.kind;
  }
}

type SearchLike =
  URLSearchParams | string | Readonly<Record<string, string | readonly string[] | undefined>>;

function toParams(search: SearchLike): URLSearchParams {
  if (typeof search === "string")
    return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (search instanceof URLSearchParams) return new URLSearchParams(search.toString());
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const one of v) out.append(k, one);
    else out.set(k, v as string);
  }
  return out;
}

/**
 * The same page with `open` set to `open` (or removed, with null), every
 * other param kept as it was: a row click opens its card over the page
 * you're on, and closing it gives you back exactly the list you had.
 */
export function hrefWithOpen(
  pathname: string,
  search: SearchLike,
  open: CrmOpen | string | null,
): string {
  const params = toParams(search);
  params.delete(OPEN_PARAM);
  if (open) params.set(OPEN_PARAM, typeof open === "string" ? open : formatOpen(open));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * The CRM pages that render CrmOverlays, so a record link there just sets
 * `open` on the page you're on. Anywhere else a record link goes to its
 * list (crmRecordHref). Add a page here when it starts rendering overlays.
 */
const OVERLAY_PAGES =
  /^\/app\/[^/]+\/crm(?:\/(?:people|companies|pipelines\/[^/]+|settings\/[^/]+))?\/?$/;

export function rendersOverlays(pathname: string): boolean {
  return OVERLAY_PAGES.test(pathname);
}
