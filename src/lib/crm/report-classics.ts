import type { IssueGroup } from "@/lib/reports/crm-widgets";

/**
 * The classics on the CRM's People and Deals reports (docs/features/crm.md,
 * "Reports"): People talked to, Converted (Talked to > Interested >
 * Converted) and Top issues. Pure helpers the server and the tests share.
 */

/** Call outcomes where nobody picked up: not a conversation. */
export const NOT_TALKED_OUTCOMES = ["voicemail", "no-answer", "busy", "wrong-number"] as const;

/** A logged call counts as talking unless its outcome says nobody answered. */
export function callWasTalk(outcome: string | null | undefined): boolean {
  return !outcome || !(NOT_TALKED_OUTCOMES as readonly string[]).includes(outcome);
}

/** Relationship ids that mean someone came on board (the setup's own types). */
const CONVERTED_IDS = new Set(["member", "client", "partner", "donor", "funder", "customer"]);
const CONVERTED_LABEL = /^(member|client|customer|partner|donor|funder|sponsor)s?$/i;

/**
 * Whether a relationship type means the person became a member, client or
 * partner (or a donor or funder): the setup's ids, or a type the
 * organization named that way. "Prospective member" is not.
 */
export function isConvertedRelationship(type: { id: string; label: string }): boolean {
  return CONVERTED_IDS.has(type.id) || CONVERTED_LABEL.test(type.label.trim());
}

export interface Funnel {
  talked: number;
  interested: number;
  converted: number;
}

/**
 * The funnel over the people talked to: each step counts the people who got
 * at least that far, so a converted person always counts as interested.
 */
export function funnelOf(
  talked: readonly string[],
  interested: ReadonlySet<string>,
  converted: ReadonlySet<string>,
): Funnel {
  let i = 0;
  let c = 0;
  for (const id of new Set(talked)) {
    if (converted.has(id)) {
      c++;
      i++;
    } else if (interested.has(id)) {
      i++;
    }
  }
  return { talked: new Set(talked).size, interested: i, converted: c };
}

/** "32%" of a whole, or null when there's no whole. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** A person's biggest issue as the enrichment keeps it (`_issue`), or null on old data. */
export function readIssue(enrichment: unknown): { text: string; at: string | null } | null {
  if (!enrichment || typeof enrichment !== "object") return null;
  const raw = (enrichment as Record<string, unknown>)._issue;
  if (!raw || typeof raw !== "object") return null;
  const text = (raw as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) return null;
  const at = (raw as { at?: unknown }).at;
  return { text: text.trim().slice(0, 300), at: typeof at === "string" ? at : null };
}

/** The same issue written two ways ("Budget." and "budget") is one. */
export function issueKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?;:,]+$/, "");
}

/** People grouped by their issue's exact text, the biggest group first. */
export function groupIssuesExactly(people: readonly { id: string; name: string; issue: string }[]): IssueGroup[] {
  const groups = new Map<string, { labels: Map<string, number>; people: { id: string; name: string }[] }>();
  for (const p of people) {
    const key = issueKey(p.issue);
    if (!key) continue;
    const g = groups.get(key) ?? { labels: new Map<string, number>(), people: [] as { id: string; name: string }[] };
    g.labels.set(p.issue.trim(), (g.labels.get(p.issue.trim()) ?? 0) + 1);
    g.people.push({ id: p.id, name: p.name });
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      // The way most of them wrote it.
      label: [...g.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
      people: g.people,
    }))
    .sort((a, b) => b.people.length - a.people.length || a.label.localeCompare(b.label));
}

/**
 * Exact groups merged as the AI said (each entry the indexes of the exact
 * groups that mean the same thing, with a short name). Groups it left out
 * stay as they were; one it named twice goes to the first.
 */
export function mergeIssueGroups(
  exact: readonly IssueGroup[],
  merged: readonly { label: string; members: readonly number[] }[],
): IssueGroup[] {
  const used = new Set<number>();
  const out: IssueGroup[] = [];
  for (const m of merged) {
    const members = [...new Set(m.members)].filter((i) => Number.isInteger(i) && i >= 0 && i < exact.length && !used.has(i));
    if (members.length === 0) continue;
    for (const i of members) used.add(i);
    const seen = new Set<string>();
    const people = members.flatMap((i) => exact[i]!.people).filter((p) => !seen.has(p.id) && Boolean(seen.add(p.id)));
    out.push({ label: m.label.trim() || exact[members[0]!]!.label, people });
  }
  exact.forEach((g, i) => {
    if (!used.has(i)) out.push(g);
  });
  return out.sort((a, b) => b.people.length - a.people.length || a.label.localeCompare(b.label));
}
