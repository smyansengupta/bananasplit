import type { ItemRef } from "@/lib/overview/types";
import type { TxClient } from "@/server/db/context";
import { readLinks, resolveRefs } from "@/server/links/links";

/**
 * What a decision or an announcement points at, through ItemLink: the
 * meeting it came from, the notes, the poll, the event it's about. The link
 * rows come from the one reader (readLinks), and each end is looked up as
 * the viewer by the one resolver (resolveRefs), so a private note or task
 * they can't open never becomes a chip.
 */

/** The kinds a decision or an announcement links to (ItemLink.toKind). */
export const HOME_LINK_KINDS = ["event", "note", "poll", "form", "task"] as const;
export type HomeLinkKind = (typeof HOME_LINK_KINDS)[number];

export interface HomeLinkRef {
  kind: HomeLinkKind;
  id: string;
}

export function isHomeLinkKind(value: unknown): value is HomeLinkKind {
  return typeof value === "string" && (HOME_LINK_KINDS as readonly string[]).includes(value);
}

/** One linked thing as the viewer sees it, with what callers word its chip from. */
export interface ResolvedHomeRef {
  ref: ItemRef;
  title: string;
  /** Events: when it starts, and how many members said they're going. */
  startsAt?: Date;
  going?: number;
}

export const refKey = (r: HomeLinkRef) => `${r.kind}:${r.id}`;

/**
 * What each of `ids` (things of `fromKind`) links to, both ways round, in
 * the order the links were made: a map from each id to its other ends.
 */
export async function linksOf(
  db: TxClient,
  organizationId: string,
  fromKind: "decision" | "announcement",
  ids: readonly string[],
): Promise<Map<string, HomeLinkRef[]>> {
  const out = new Map<string, HomeLinkRef[]>();
  const ends = await readLinks(
    db,
    organizationId,
    ids.map((id) => ({ kind: fromKind, id })),
    { otherKinds: HOME_LINK_KINDS, order: "asc" },
  );
  for (const { at, other } of ends) {
    if (!isHomeLinkKind(other.kind)) continue;
    const mine = at.slice(fromKind.length + 1);
    const list = out.get(mine) ?? [];
    if (!list.some((x) => x.kind === other.kind && x.id === other.id)) {
      list.push({ kind: other.kind, id: other.id });
    }
    out.set(mine, list);
  }
  return out;
}

/**
 * Looks each reference up as the viewer (resolveRefs); the ones they can't
 * see, or that are gone, are left out. A meeting is a "meeting" chip on its
 * meeting page, anything else on the calendar an "event" on the calendar;
 * a quick-poll form is a "poll" chip.
 */
export async function resolveHomeRefs(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  refs: readonly HomeLinkRef[],
): Promise<Map<string, ResolvedHomeRef>> {
  const out = new Map<string, ResolvedHomeRef>();
  const resolved = await resolveRefs(db, organizationId, orgSlug, refs);
  for (const [at, hit] of resolved) {
    out.set(at, {
      ref: { kind: hit.chip, label: hit.title, href: hit.href },
      title: hit.title,
      ...(hit.startsAt ? { startsAt: hit.startsAt, going: hit.going ?? 0 } : {}),
    });
  }
  return out;
}

/** "Oct 26" in the organization's time zone. */
export function shortDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
}
