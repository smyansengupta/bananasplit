import type { OrgChartParse } from "./schema";
import { clamp, cleanBullets, cleanLine, foldCase, positionKeyFromTitle, uniqueKey } from "./text";
import type { ChartWarning, OpenItem } from "./types";

/**
 * Deterministic normalization of a raw parse (Claude's output, or the
 * expected-shaped fixture) into the chart the draft editor shows. Pure.
 *
 * - Ids are re-keyed by title slug ("VP Ops & Programs" -> vp-ops-programs),
 *   with -2, -3 suffixes on collisions. References are resolved by id, then
 *   by key, title or person name, so "reports_to": "Jackson" still works.
 * - reports_to is canonical. manages only fills a missing reports_to and
 *   raises a warning when it disagrees; manages is then recomputed from
 *   reports_to (advisors listed separately).
 * - Dangling and self references are dropped; cycles are broken at the
 *   earliest position in the cycle; several roots raise a warning.
 * - Advisors must report to someone and manage nobody; otherwise the flag
 *   is removed with a warning.
 * - An open position carries no person. Bullets are cleaned, deduplicated
 *   and clamped. Nothing here trusts the document: every string is bounded.
 */

export const LIMITS = {
  positions: 200,
  title: 120,
  personName: 120,
  bullet: 400,
  bullets: 25,
  quote: 500,
  quotes: 10,
  openItems: 50,
  who: 120,
  question: 500,
} as const;

export interface NormalizedPosition {
  key: string;
  title: string;
  personName: string | null;
  /** Key of the manager, or null for a root. */
  reportsTo: string | null;
  /** Keys of the non-advisor direct reports, in document order. */
  manages: string[];
  /** Keys of the advisors beside this position. */
  advisors: string[];
  responsibilities: string[];
  decidesAlone: string[];
  sourceQuote: string[];
  isOpen: boolean;
  isAdvisor: boolean;
}

export interface NormalizedChart {
  positions: NormalizedPosition[];
  openItems: OpenItem[];
  warnings: ChartWarning[];
}

/** Person-name values that mean "nobody yet". */
const OPEN_MARKER =
  /^\[?\s*(open(\s+(hire|role|position|seat))?|vacant|vacancy|tbd|tba|to be (hired|determined|announced|filled)|hiring|unfilled|none|n\/?a|-+|\?+)\s*\]?$/i;

export function isOpenMarker(name: string): boolean {
  return OPEN_MARKER.test(name.trim());
}

interface Working {
  index: number;
  rawId: string;
  key: string;
  title: string;
  personName: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
  sourceQuote: string[];
  reportsToRef: string | null;
  managesRefs: string[];
  reportsTo: number | null;
}

function firstToken(name: string): string {
  return foldCase(name).split(/\s+/)[0] ?? "";
}

export function normalizeOrgChart(raw: OrgChartParse): NormalizedChart {
  const warnings: ChartWarning[] = [];
  const warn = (w: ChartWarning) => warnings.push(w);

  if (raw.positions.length > LIMITS.positions) {
    warn({
      code: "truncated",
      message: `The document has ${raw.positions.length} positions; only the first ${LIMITS.positions} were kept.`,
    });
  }

  // 1. Clean each position and give it a key.
  const takenKeys = new Set<string>();
  const items: Working[] = [];
  for (const p of raw.positions.slice(0, LIMITS.positions)) {
    const title = clamp(cleanLine(p.title), LIMITS.title);
    if (!title) {
      warn({ code: "empty-title", message: "A position with no title was skipped." });
      continue;
    }
    let personName: string | null = clamp(cleanLine(p.person_name), LIMITS.personName) || null;
    let isOpen = p.is_open === true;
    if (personName && isOpenMarker(personName)) {
      personName = null;
      isOpen = true;
    }
    const key = uniqueKey(positionKeyFromTitle(title), takenKeys);
    if (isOpen && personName) {
      warn({
        code: "open-with-person",
        positionKey: key,
        message: `${title} is marked as an open hire, so the name "${personName}" was not kept.`,
      });
      personName = null;
    }
    items.push({
      index: items.length,
      rawId: cleanLine(p.id),
      key,
      title,
      personName,
      isOpen,
      isAdvisor: p.is_advisor === true,
      responsibilities: cleanBullets(p.responsibilities, LIMITS.bullets, LIMITS.bullet),
      decidesAlone: cleanBullets(p.decides_alone, LIMITS.bullets, LIMITS.bullet),
      sourceQuote: cleanBullets(p.source_quote, LIMITS.quotes, LIMITS.quote),
      reportsToRef: cleanLine(p.reports_to) || null,
      managesRefs: p.manages.map((m) => cleanLine(m)).filter(Boolean),
      reportsTo: null,
    });
  }

  if (items.length === 0) {
    warn({ code: "no-positions", message: "No positions were found in the document." });
  }

  // 2. Reference resolution: id, then key, title, full name, unique first name.
  const byId = new Map<string, number>();
  const byIdFolded = new Map<string, number>();
  for (const item of items) {
    if (!item.rawId) continue;
    if (byId.has(item.rawId)) {
      warn({
        code: "duplicate-id",
        positionKey: item.key,
        message: `Two positions share the id "${clamp(item.rawId, 60)}"; references use the first one.`,
      });
      continue;
    }
    byId.set(item.rawId, item.index);
    if (!byIdFolded.has(foldCase(item.rawId))) byIdFolded.set(foldCase(item.rawId), item.index);
  }
  const unique = <T>(list: T[]): T | undefined => (list.length === 1 ? list[0] : undefined);

  function resolve(ref: string): number | undefined {
    const exact = byId.get(ref);
    if (exact !== undefined) return exact;
    const folded = foldCase(ref).trim();
    const byFold = byIdFolded.get(folded);
    if (byFold !== undefined) return byFold;
    const asKey = positionKeyFromTitle(ref);
    const keyHit = items.find((i) => i.key === asKey);
    if (keyHit) return keyHit.index;
    const titleHit = unique(items.filter((i) => foldCase(i.title) === folded));
    if (titleHit) return titleHit.index;
    const nameHit = unique(items.filter((i) => i.personName && foldCase(i.personName) === folded));
    if (nameHit) return nameHit.index;
    if (!/\s/.test(folded)) {
      const firstHit = unique(items.filter((i) => i.personName && firstToken(i.personName) === folded));
      if (firstHit) return firstHit.index;
    }
    // Last resort: a unique title containing the reference as whole words
    // ("Designer" -> "Graphic Designer").
    const words = folded.replace(/[^a-z0-9]+/g, " ").trim();
    if (words.length >= 3) {
      const pattern = new RegExp(`(^|\\s)${words.replace(/\s+/g, "\\s+")}(\\s|$)`);
      const partial = unique(
        items.filter((i) => pattern.test(foldCase(i.title).replace(/[^a-z0-9]+/g, " ").trim())),
      );
      if (partial) return partial.index;
    }
    return undefined;
  }

  for (const item of items) {
    if (!item.reportsToRef) continue;
    const target = resolve(item.reportsToRef);
    if (target === undefined) {
      warn({
        code: "dangling",
        positionKey: item.key,
        message: `${item.title} reports to "${clamp(item.reportsToRef, 60)}", which is not in the chart; it was left without a manager.`,
      });
    } else if (target === item.index) {
      warn({
        code: "self-reference",
        positionKey: item.key,
        message: `${item.title} was listed as reporting to itself; it was left without a manager.`,
      });
    } else {
      item.reportsTo = target;
    }
  }

  // 3. manages fills gaps; disagreements are warnings (reports_to wins).
  for (const item of items) {
    for (const ref of item.managesRefs) {
      const target = resolve(ref);
      if (target === undefined) {
        warn({
          code: "dangling",
          positionKey: item.key,
          message: `${item.title} manages "${clamp(ref, 60)}", which is not in the chart.`,
        });
        continue;
      }
      if (target === item.index) continue;
      const report = items[target];
      if (report.reportsTo === null) {
        report.reportsTo = item.index;
        warn({
          code: "manages-filled",
          positionKey: report.key,
          message: `${report.title} had no manager; it now reports to ${item.title}, which lists it under 'manages'.`,
        });
      } else if (report.reportsTo !== item.index) {
        warn({
          code: "manages-mismatch",
          positionKey: report.key,
          message: `${item.title} lists ${report.title} under 'manages', but ${report.title} reports to ${items[report.reportsTo].title}. Kept 'reports to'.`,
        });
      }
    }
  }

  // 4. Break cycles at the earliest position in each cycle.
  for (;;) {
    const cycle = findCycle(items);
    if (!cycle) break;
    const breakAt = Math.min(...cycle);
    const titles = cycle.map((i) => items[i].title).join(" → ");
    items[breakAt].reportsTo = null;
    warn({
      code: "cycle",
      positionKey: items[breakAt].key,
      message: `The reporting lines form a loop (${titles}); ${items[breakAt].title} was moved to the top.`,
    });
  }

  // 5. Advisors report to someone and manage nobody.
  for (let changed = true; changed; ) {
    changed = false;
    const hasReports = new Set(items.filter((i) => i.reportsTo !== null).map((i) => i.reportsTo as number));
    for (const item of items) {
      if (!item.isAdvisor) continue;
      if (item.reportsTo === null) {
        item.isAdvisor = false;
        changed = true;
        warn({
          code: "advisor-no-manager",
          positionKey: item.key,
          message: `${item.title} is marked as an advisor but advises nobody; it is shown in the main chart.`,
        });
      } else if (hasReports.has(item.index)) {
        item.isAdvisor = false;
        changed = true;
        warn({
          code: "advisor-has-reports",
          positionKey: item.key,
          message: `${item.title} is marked as an advisor but has reports; it is shown in the main chart.`,
        });
      }
    }
  }

  // 6. Several roots.
  const roots = items.filter((i) => i.reportsTo === null && !i.isAdvisor);
  if (roots.length > 1) {
    warn({
      code: "multiple-roots",
      message: `${roots.length} positions report to nobody (${roots
        .map((r) => r.title)
        .slice(0, 5)
        .join(", ")}${roots.length > 5 ? ", …" : ""}). Check who they report to.`,
    });
  }

  const positions: NormalizedPosition[] = items.map((item) => {
    const reports = items.filter((i) => i.reportsTo === item.index);
    return {
      key: item.key,
      title: item.title,
      personName: item.personName,
      reportsTo: item.reportsTo === null ? null : items[item.reportsTo].key,
      manages: reports.filter((r) => !r.isAdvisor).map((r) => r.key),
      advisors: reports.filter((r) => r.isAdvisor).map((r) => r.key),
      responsibilities: item.responsibilities,
      decidesAlone: item.decidesAlone,
      sourceQuote: item.sourceQuote,
      isOpen: item.isOpen,
      isAdvisor: item.isAdvisor,
    };
  });

  return { positions, openItems: normalizeOpenItems(raw.open_items), warnings };
}

/** Indexes of one cycle in the reportsTo graph, or null. */
function findCycle(items: readonly Working[]): number[] | null {
  const state = new Array<0 | 1 | 2>(items.length).fill(0);
  for (const start of items) {
    if (state[start.index] !== 0) continue;
    const path: number[] = [];
    let current: number | null = start.index;
    while (current !== null && state[current] === 0) {
      state[current] = 1;
      path.push(current);
      current = items[current].reportsTo;
    }
    if (current !== null && state[current] === 1) {
      return path.slice(path.indexOf(current));
    }
    for (const i of path) state[i] = 2;
  }
  return null;
}

/** Open items: cleaned, clamped, deduplicated, at most LIMITS.openItems. */
export function normalizeOpenItems(items: readonly { who: string; question: string }[]): OpenItem[] {
  const seen = new Set<string>();
  const out: OpenItem[] = [];
  for (const item of items) {
    const who = clamp(cleanLine(item.who), LIMITS.who);
    const question = clamp(cleanLine(item.question), LIMITS.question);
    if (!question) continue;
    const fold = `${who.toLowerCase()}|${question.toLowerCase()}`;
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push({ who, question });
    if (out.length >= LIMITS.openItems) break;
  }
  return out;
}
