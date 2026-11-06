import type { DiffChange, DiffPosition } from "./diff";
import type { MatchState } from "./types";

/**
 * "Publish the new org chart": what changes from the chart everyone sees,
 * in plain sentences, and whose titles change with it. Pure and
 * client-safe; the server's publish uses the same highestTitles.
 */

export interface TitleRow {
  id: string;
  userId: string | null;
  reportsToId: string | null;
  title: string;
  rank: string;
  matchState: MatchState;
}

/** Each linked member's highest position title (fewest managers above, then rank). */
export function highestTitles(rows: readonly TitleRow[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = (r: TitleRow) => {
    let d = 0;
    const seen = new Set<string>();
    let cur = r.reportsToId ? byId.get(r.reportsToId) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      d++;
      cur = cur.reportsToId ? byId.get(cur.reportsToId) : undefined;
    }
    return d;
  };
  const best = new Map<string, { title: string; depth: number; rank: string }>();
  for (const r of rows) {
    if (!r.userId || r.matchState !== "CONFIRMED") continue;
    const d = depth(r);
    const cur = best.get(r.userId);
    if (!cur || d < cur.depth || (d === cur.depth && r.rank < cur.rank)) {
      best.set(r.userId, { title: r.title, depth: d, rank: r.rank });
    }
  }
  return new Map([...best].map(([userId, v]) => [userId, v.title]));
}

export interface TitleChange {
  userId: string;
  name: string | null;
  from: string | null;
  to: string;
}

/** Members whose profile title changes when the chart publishes with titles on. */
export function titleChanges(
  rows: readonly TitleRow[],
  members: readonly { id: string; name: string | null; title: string | null }[],
): TitleChange[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: TitleChange[] = [];
  for (const [userId, to] of highestTitles(rows)) {
    const m = byId.get(userId);
    if (!m) continue;
    const from = m.title?.trim() || null;
    if (from !== to.trim()) out.push({ userId, name: m.name, from, to });
  }
  return out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export type ChangeKind =
  "added" | "open" | "removed" | "renamed" | "moved" | "filled" | "person" | "other";

export interface ChangeLine {
  id: string;
  kind: ChangeKind;
  /** The position, in bold. */
  title: string;
  /** The rest of the sentence after the title. */
  text: string;
  detail: string | null;
  /** Whose avatar sits beside it. */
  userId: string | null;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Each change as a sentence: "Graphic Designer is a new open role,
 * reports to VP Growth". `after` is the draft (for managers and people),
 * `titled` the members whose profile title follows the change.
 */
export function describeChanges(
  changes: readonly DiffChange[],
  after: readonly DiffPosition[],
  titled: readonly TitleChange[] = [],
): ChangeLine[] {
  const byKey = new Map(after.map((p) => [p.key, p]));
  const titleOf = (key: string | null) => (key ? (byKey.get(key)?.title ?? null) : null);
  const titledBy = new Map(titled.map((t) => [t.userId, t]));
  return changes.map((c, i): ChangeLine => {
    const p = byKey.get(c.key);
    const userId = p?.userId ?? null;
    const id = `${c.type}:${c.key}:${i}`;
    switch (c.type) {
      case "added": {
        const manager = titleOf(p?.reportsToKey ?? null);
        const reports = manager ? `Reports to ${manager}` : "At the top of the chart";
        return p?.isOpen
          ? {
              id,
              kind: "open",
              title: c.title,
              text: "is a new open role",
              detail: reports,
              userId,
            }
          : {
              id,
              kind: "added",
              title: c.title,
              text: "is new",
              detail: p?.personName ? `${p.personName}. ${reports}` : reports,
              userId,
            };
      }
      case "removed":
        return {
          id,
          kind: "removed",
          title: c.title,
          text: "comes off the chart",
          detail: c.person === "Open hire" || c.person === "Unfilled" ? null : c.person,
          userId: null,
        };
      case "retitled": {
        const t = userId ? titledBy.get(userId) : undefined;
        return {
          id,
          kind: "renamed",
          title: c.from,
          text: `is now ${c.to}`,
          detail:
            t && t.to === c.to
              ? t.name
                ? `${t.name}'s title changes on their profile too`
                : "Their title changes on their profile too"
              : null,
          userId,
        };
      }
      case "reparented":
        return {
          id,
          kind: "moved",
          title: c.title,
          text: c.to ? `moves under ${c.to}` : "moves to the top of the chart",
          detail: c.from ? `Was under ${c.from}` : "Was at the top of the chart",
          userId,
        };
      case "person":
        if (c.from === "Open hire" || c.from === "Unfilled")
          return {
            id,
            kind: "filled",
            title: c.title,
            text: "is filled",
            detail: `${c.to}, was an open role`,
            userId,
          };
        if (c.to === "Open hire" || c.to === "Unfilled")
          return {
            id,
            kind: "open",
            title: c.title,
            text: "is now an open role",
            detail: `${c.from} leaves it`,
            userId: null,
          };
        return {
          id,
          kind: "person",
          title: c.title,
          text: `goes to ${c.to}`,
          detail: `Was ${c.from}`,
          userId,
        };
      case "dotted":
        return {
          id,
          kind: "other",
          title: c.title,
          text: c.added.length ? `also reports to ${list(c.added)}` : "has one manager again",
          detail: c.removed.length ? `No longer also reports to ${list(c.removed)}` : null,
          userId,
        };
      case "advisor":
        return {
          id,
          kind: "other",
          title: c.title,
          text: c.value ? "is now an advisor" : "is no longer an advisor",
          detail: null,
          userId,
        };
      case "content": {
        const what = c.field === "responsibilities" ? "what they do" : "what they decide alone";
        const parts = [
          c.added.length ? `${c.added.length} added` : "",
          c.removed.length ? `${c.removed.length} removed` : "",
        ].filter(Boolean);
        return {
          id,
          kind: "other",
          title: c.title,
          text: `has changes to ${what}`,
          detail: parts.join(", "),
          userId,
        };
      }
    }
  });
}
