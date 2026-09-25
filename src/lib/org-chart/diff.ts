import { foldCase } from "./text";

/**
 * Differences between two chart versions, by position key (versions page).
 * Positions that changed key but kept the same linked member or person name
 * are paired as a retitle rather than a removal plus an addition. Pure.
 */

export interface DiffPosition {
  key: string;
  title: string;
  /** Key of the manager in the same version. */
  reportsToKey: string | null;
  userId: string | null;
  /** What the chart shows for the person: member name, placeholder name or "Open hire". */
  personLabel: string;
  /** The person's name (member or placeholder); null when open or unfilled. */
  personName: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
}

export type DiffChange =
  | { type: "added"; key: string; title: string; person: string }
  | { type: "removed"; key: string; title: string; person: string }
  | { type: "retitled"; key: string; from: string; to: string }
  | { type: "reparented"; key: string; title: string; from: string | null; to: string | null }
  | { type: "person"; key: string; title: string; from: string; to: string }
  | { type: "advisor"; key: string; title: string; value: boolean }
  | {
      type: "content";
      key: string;
      title: string;
      field: "responsibilities" | "decidesAlone";
      added: string[];
      removed: string[];
    };

function listDiff(before: readonly string[], after: readonly string[]) {
  const b = new Set(before.map((s) => foldCase(s.trim())));
  const a = new Set(after.map((s) => foldCase(s.trim())));
  return {
    added: after.filter((s) => !b.has(foldCase(s.trim()))),
    removed: before.filter((s) => !a.has(foldCase(s.trim()))),
  };
}

export function diffCharts(
  before: readonly DiffPosition[],
  after: readonly DiffPosition[],
): DiffChange[] {
  const beforeByKey = new Map(before.map((p) => [p.key, p]));
  const afterByKey = new Map(after.map((p) => [p.key, p]));

  // Pair by key, then leftovers by linked member, then by person name.
  const pairs: [DiffPosition, DiffPosition][] = [];
  const removed = before.filter((p) => !afterByKey.has(p.key));
  const added = after.filter((p) => !beforeByKey.has(p.key));
  for (const p of before) {
    const q = afterByKey.get(p.key);
    if (q) pairs.push([p, q]);
  }
  const pairBy = (sel: (p: DiffPosition) => string | null) => {
    for (const r of [...removed]) {
      const id = sel(r);
      if (!id) continue;
      const candidates = added.filter((a) => sel(a) === id);
      if (candidates.length !== 1 || removed.filter((x) => sel(x) === id).length !== 1) continue;
      const match = candidates[0];
      pairs.push([r, match]);
      removed.splice(removed.indexOf(r), 1);
      added.splice(added.indexOf(match), 1);
    }
  };
  pairBy((p) => p.userId);
  pairBy((p) => (p.isOpen || !p.personName ? null : foldCase(p.personName)));

  // Manager titles resolve in their own version.
  const beforeTitle = (key: string | null) => (key ? (beforeByKey.get(key)?.title ?? key) : null);
  const afterTitle = (key: string | null) => (key ? (afterByKey.get(key)?.title ?? key) : null);
  // Keys renamed by pairing count as the same manager.
  const renamed = new Map(pairs.map(([p, q]) => [p.key, q.key]));

  const changes: DiffChange[] = [];
  for (const [p, q] of pairs) {
    if (p.title !== q.title)
      changes.push({ type: "retitled", key: q.key, from: p.title, to: q.title });
    const fromManager = p.reportsToKey ? (renamed.get(p.reportsToKey) ?? p.reportsToKey) : null;
    if (fromManager !== q.reportsToKey) {
      changes.push({
        type: "reparented",
        key: q.key,
        title: q.title,
        from: beforeTitle(p.reportsToKey),
        to: afterTitle(q.reportsToKey),
      });
    }
    if (p.userId !== q.userId || p.personLabel !== q.personLabel || p.isOpen !== q.isOpen) {
      changes.push({
        type: "person",
        key: q.key,
        title: q.title,
        from: p.personLabel,
        to: q.personLabel,
      });
    }
    if (p.isAdvisor !== q.isAdvisor) {
      changes.push({ type: "advisor", key: q.key, title: q.title, value: q.isAdvisor });
    }
    for (const field of ["responsibilities", "decidesAlone"] as const) {
      const d = listDiff(p[field], q[field]);
      if (d.added.length || d.removed.length) {
        changes.push({ type: "content", key: q.key, title: q.title, field, ...d });
      }
    }
  }
  for (const p of removed)
    changes.push({ type: "removed", key: p.key, title: p.title, person: p.personLabel });
  for (const p of added)
    changes.push({ type: "added", key: p.key, title: p.title, person: p.personLabel });

  const order: Record<DiffChange["type"], number> = {
    added: 0,
    removed: 1,
    retitled: 2,
    reparented: 3,
    person: 4,
    advisor: 5,
    content: 6,
  };
  return changes.sort((a, b) => order[a.type] - order[b.type]);
}
