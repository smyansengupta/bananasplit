import { generateNKeysBetween } from "fractional-indexing";

import { newPositionId, type DraftPosition } from "./draft";
import { effectiveParents } from "./layout";
import { matchPerson, normalizeName, type MatchCandidate } from "./match";
import { LIMITS } from "./normalize";
import { compareRank } from "./types";

/**
 * The org chart you can type (Moonstone 12.3): one position per line,
 * "Title — @Name", indentation for who reports to whom. Pure and
 * client-safe, so the editor, the paste path and the server's "start from
 * members" all read text by the same rules.
 *
 *   President — @Maya Patel
 *     Advisor: Faculty advisor — Dr. Lee
 *     VP Events — @Ana Kim
 *       Open: Events coordinator
 *       Designer — Sam Ortiz (also reports to Ana Kim)
 *
 * - A line indented more than the one above reports to it; equal is a
 *   sibling; less goes back up to the last line at that depth (any
 *   consistent indent works: two spaces, four, tabs).
 * - Bullets, numbers and drawn-tree connectors ("- ", "1. ", "├── ", "│")
 *   are part of the indent, so pasted lists and trees keep their shape.
 * - The person follows a dash (— – - or --), a colon or a bar. "@Name"
 *   links a member whose name matches exactly; a plain name is a
 *   suggestion to confirm (nothing is linked behind the admin's back).
 * - "Open:" (or a person of Open, TBD, Vacant, [open hire]) marks an
 *   unfilled role; "Advisor:" or "(advisor)" an advisor.
 * - "(also reports to Name)" at the end adds extra managers (dotted lines),
 *   by title or person, separated by commas; the indent stays the main line.
 */

export interface OutlineLine {
  /** The line number in the text, from 0. */
  line: number;
  depth: number;
  /** Index of the manager's entry in the returned list, or null (top). */
  parent: number | null;
  title: string;
  /** The person as typed, without the "@", or null. */
  person: string | null;
  /** Typed as "@Name": an explicit link to a member. */
  mention: boolean;
  isOpen: boolean;
  isAdvisor: boolean;
  /** Extra managers as typed (titles or names), from "(also reports to ...)". */
  also: string[];
}

const ALSO = /\s*\(\s*also(?:\s+reports?\s+to\s*:?|\s*:)\s*([^()]*)\)\s*/gi;

const LEAD = /^[\s│┃|├┣└┗┬┼╰╠╚`+\\─━—–\-*•‣◦▪·>]*/u;
const NUMBERED = /^(?:\d+(?:\.\d+)*[.)]|[a-zA-Z][.)])\s+/;
const HEADING = /^#{1,6}\s+/;
const OPEN_PERSON = /^(?:\[?\s*open(?:\s+(?:hire|role|position))?\s*\]?|\(?\s*(?:open|vacant|tbd|tba|hiring)\s*\)?|n\/a|none|-|\?)$/i;
const SEPARATORS = [/\s+[—–]+\s*|\s*[—–]+\s+/, /\s+-{1,2}\s+/, /\s*:\s+/, /\s+\|\s+/];

function width(lead: string): number {
  let w = 0;
  for (const ch of lead) w += ch === "\t" ? 4 : 1;
  return w;
}

function splitPerson(text: string): { title: string; person: string | null } {
  let best: { index: number; length: number } | null = null;
  for (const re of SEPARATORS) {
    const m = re.exec(text);
    if (m && m.index > 0 && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length };
  }
  if (best) return { title: text.slice(0, best.index).trim(), person: text.slice(best.index + best.length).trim() || null };
  // "Title @Name" with no separator.
  const at = text.search(/(?:^|\s)@\S/);
  if (at >= 0) {
    const i = text.indexOf("@", at);
    return { title: text.slice(0, i).trim(), person: text.slice(i).trim() };
  }
  return { title: text.trim(), person: null };
}

/** One entry per non-blank line, in order. */
export function parseOutline(text: string): OutlineLine[] {
  const out: OutlineLine[] = [];
  const stack: { width: number; index: number }[] = [];
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  for (let line = 0; line < rows.length && out.length < LIMITS.positions; line++) {
    const raw = rows[line];
    if (!raw.trim()) continue;
    const lead = LEAD.exec(raw)?.[0] ?? "";
    let rest = raw.slice(lead.length);
    let w = width(lead);
    const heading = HEADING.exec(rest);
    if (heading) {
      // "## VP Ops — Oliver": the heading level is the depth.
      w += (heading[0].trim().length - 1) * 2;
      rest = rest.slice(heading[0].length);
    }
    const numbered = NUMBERED.exec(rest);
    if (numbered) {
      w += numbered[0].length;
      rest = rest.slice(numbered[0].length);
    }
    rest = rest.replace(/\*\*|__/g, "").trim();
    if (!rest) continue;

    let isOpen = false;
    let isAdvisor = false;
    for (;;) {
      const prefix = /^(open|vacant|advisor)\s*:\s*/i.exec(rest);
      if (!prefix) break;
      if (prefix[1].toLowerCase() === "advisor") isAdvisor = true;
      else isOpen = true;
      rest = rest.slice(prefix[0].length);
    }
    if (/\(\s*advisor\s*\)/i.test(rest)) {
      isAdvisor = true;
      rest = rest.replace(/\s*\(\s*advisor\s*\)\s*/gi, " ").trim();
    }
    const also: string[] = [];
    rest = rest
      .replace(ALSO, (_m, refs: string) => {
        for (const ref of refs.split(/\s*(?:,|;|&|\band\b)\s*/i)) {
          const clean = ref.replace(/^@+/, "").trim();
          if (clean && also.length < LIMITS.alsoReportsTo) also.push(clean.slice(0, LIMITS.title));
        }
        return " ";
      })
      .trim();
    if (/\[\s*open(?:\s+hire)?\s*\]|\(\s*(?:open|vacant)\s*\)/i.test(rest)) {
      isOpen = true;
      rest = rest.replace(/\s*(?:\[\s*open(?:\s+hire)?\s*\]|\(\s*(?:open|vacant)\s*\))\s*/gi, " ").trim();
    }

    const split = splitPerson(rest);
    let person = split.person;
    let mention = false;
    if (person) {
      mention = person.startsWith("@");
      person = person.replace(/^@+/, "").trim() || null;
      if (person && OPEN_PERSON.test(person)) {
        isOpen = true;
        person = null;
      }
    }
    if (isOpen) {
      person = null;
      mention = false;
    }
    const title = (split.title || (person ? "Member" : "")).slice(0, LIMITS.title);
    if (!title) continue;

    while (stack.length && stack[stack.length - 1].width >= w) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].index : null;
    out.push({
      line,
      depth: stack.length,
      parent,
      title,
      person: person ? person.slice(0, LIMITS.personName) : null,
      mention,
      isOpen,
      isAdvisor,
      also,
    });
    stack.push({ width: w, index: out.length - 1 });
  }
  return out;
}

export interface OutlineMember {
  id: string;
  name: string | null;
}

/** The positions in outline order (managers before their reports, siblings by rank), with depth. */
export function outlineOrder(positions: readonly DraftPosition[]): { position: DraftPosition; depth: number }[] {
  const parents = effectiveParents(positions.map((p) => ({ id: p.id, reportsToId: p.reportsTo, isAdvisor: p.isAdvisor, rank: p.rank })));
  const children = new Map<string | null, DraftPosition[]>();
  for (const p of positions) {
    const parent = parents.get(p.id) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  for (const list of children.values()) list.sort(compareRank);
  const out: { position: DraftPosition; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of children.get(parent) ?? []) {
      out.push({ position: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The text for `positions` (what the editor shows when it opens). */
export function serializeOutline(positions: readonly DraftPosition[], members: readonly OutlineMember[]): string {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const byId = new Map(positions.map((p) => [p.id, p]));
  // An extra manager by its person when that name is unique, else by its title.
  const count = (values: string[]) => values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>());
  const titles = count(positions.map((p) => normTitle(p.title)));
  const people = count(positions.map((p) => personOf(p, names)).filter(Boolean));
  const refFor = (p: DraftPosition) => {
    const person = p.isOpen ? null : p.userId ? (names.get(p.userId) ?? p.personName) : p.personName;
    if (person && people.get(norm(person)) === 1 && !titles.has(normTitle(person))) return person;
    return p.title;
  };
  return outlineOrder(positions)
    .map(({ position: p, depth }) => {
      const linked = p.userId && p.matchState === "CONFIRMED" ? (names.get(p.userId) ?? p.personName) : null;
      const person = p.isOpen ? null : linked ? `@${linked}` : p.personName;
      const also = (p.alsoReportsTo ?? []).flatMap((id) => {
        const manager = byId.get(id);
        return manager && id !== p.reportsTo ? [refFor(manager)] : [];
      });
      return `${"  ".repeat(depth)}${p.isAdvisor ? "Advisor: " : ""}${p.isOpen ? "Open: " : ""}${p.title}${person ? ` — ${person}` : ""}${also.length ? ` (also reports to ${also.join(", ")})` : ""}`;
    })
    .join("\n");
}

const norm = (s: string | null | undefined) => (s ? normalizeName(s) : "");
const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function personOf(p: DraftPosition, names: ReadonlyMap<string, string | null>): string {
  return norm(p.userId ? (names.get(p.userId) ?? p.personName) : p.personName);
}

/**
 * The draft for `lines`, reusing `previous` positions where a line is the
 * same position (same title and person, same title, same person, or the
 * same place in the outline), so ids, keys, responsibilities, decisions
 * and confirmed links survive typing. Members are linked when the line
 * says "@Name" and exactly one member has that name; otherwise the name is
 * matched as the importer does (suggestions to confirm, or a placeholder).
 */
export function applyOutline(
  previous: readonly DraftPosition[],
  lines: readonly OutlineLine[],
  members: readonly OutlineMember[],
): DraftPosition[] {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const candidates: MatchCandidate[] = members.map((m) => ({ userId: m.id, name: m.name }));
  const byName = new Map<string, string[]>();
  for (const m of members) {
    const k = norm(m.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), m.id]);
  }

  const order = outlineOrder(previous).map((o) => o.position);
  const used = new Set<string>();
  const reuse: (DraftPosition | null)[] = lines.map(() => null);
  const passes: ((line: OutlineLine, prev: DraftPosition, i: number, j: number) => boolean)[] = [
    (l, p) => normTitle(l.title) === normTitle(p.title) && norm(l.person) === personOf(p, names) && l.isOpen === p.isOpen,
    (l, p) => normTitle(l.title) === normTitle(p.title),
    (l, p) => Boolean(l.person) && norm(l.person) === personOf(p, names),
    (_l, _p, i, j) => i === j,
  ];
  for (const pass of passes) {
    lines.forEach((line, i) => {
      if (reuse[i]) return;
      const j = order.findIndex((p, j) => !used.has(p.id) && pass(line, p, i, j));
      if (j >= 0) {
        reuse[i] = order[j];
        used.add(order[j].id);
      }
    });
  }

  const ids = lines.map((_, i) => reuse[i]?.id ?? newPositionId());
  const ranks = generateNKeysBetween(null, null, lines.length);
  const drafted = lines.map((line, i) => {
    const prev = reuse[i];
    const base: DraftPosition = prev
      ? { ...prev }
      : {
          id: ids[i],
          key: "",
          title: line.title,
          personName: null,
          userId: null,
          matchState: "UNMATCHED",
          matchScore: null,
          suggestedUserIds: [],
          reportsTo: null,
          isOpen: false,
          isAdvisor: false,
          responsibilities: [],
          decidesAlone: [],
          sourceQuote: [],
          rank: ranks[i],
        };
    const person = line.isOpen ? null : line.person;
    let link: Pick<DraftPosition, "personName" | "userId" | "matchState" | "matchScore" | "suggestedUserIds">;
    if (!person) {
      link = { personName: null, userId: null, matchState: "UNMATCHED", matchScore: null, suggestedUserIds: [] };
    } else if (prev && prev.userId && personOf(prev, names) === norm(person) && (prev.matchState === "CONFIRMED" || !line.mention)) {
      // Same person as before: keep the link (and its confirmation) as it was.
      link = {
        personName: prev.personName ?? names.get(prev.userId) ?? person,
        userId: prev.userId,
        matchState: prev.matchState,
        matchScore: prev.matchScore,
        suggestedUserIds: prev.suggestedUserIds,
      };
    } else {
      const exact = byName.get(norm(person)) ?? [];
      if (line.mention && exact.length === 1) {
        link = { personName: names.get(exact[0]) ?? person, userId: exact[0], matchState: "CONFIRMED", matchScore: 1, suggestedUserIds: [exact[0]] };
      } else {
        const match = matchPerson(person, candidates);
        link = {
          personName: person,
          userId: null,
          matchState: match.state,
          matchScore: match.score,
          suggestedUserIds: match.suggestions.map((s) => s.userId),
        };
      }
    }
    return {
      ...base,
      ...link,
      title: line.title,
      isOpen: line.isOpen,
      isAdvisor: line.isAdvisor,
      reportsTo: line.parent === null ? null : ids[line.parent],
      rank: ranks[i],
    };
  });
  return withTypedAlso(drafted, lines, names);
}

/**
 * Each line's "(also reports to ...)" as extra managers: a reference is a
 * title, a person's full name, or a first name that only one person has.
 * The text is the source of truth, so a line without one has none.
 */
function withTypedAlso(
  positions: DraftPosition[],
  lines: readonly OutlineLine[],
  names: ReadonlyMap<string, string | null>,
): DraftPosition[] {
  const unique = (list: DraftPosition[]) => (list.length === 1 ? list[0] : undefined);
  const resolve = (ref: string): DraftPosition | undefined => {
    const t = normTitle(ref);
    const n = norm(ref);
    return (
      unique(positions.filter((p) => normTitle(p.title) === t)) ??
      unique(positions.filter((p) => n && personOf(p, names) === n)) ??
      (/\s/.test(n) ? undefined : unique(positions.filter((p) => n && personOf(p, names).split(/\s+/)[0] === n)))
    );
  };
  return positions.map((p, i) => {
    const also: string[] = [];
    for (const ref of lines[i].also) {
      const manager = resolve(ref);
      if (manager && manager.id !== p.id && manager.id !== p.reportsTo && !also.includes(manager.id)) also.push(manager.id);
    }
    return { ...p, alsoReportsTo: also };
  });
}

/** Lines whose person is not a member (shown with an "invite" option). */
export function unknownPeople(positions: readonly DraftPosition[]): DraftPosition[] {
  return positions.filter((p) => !p.isOpen && p.personName && !p.userId);
}

/** Members who hold no position in `positions` (the "Not on the chart yet" tray). */
export function membersOffChart<M extends OutlineMember>(positions: readonly DraftPosition[], members: readonly M[]): M[] {
  const on = new Set(positions.map((p) => p.userId).filter(Boolean));
  return members.filter((m) => !on.has(m.id));
}

// ------------------------------------------------------------ start from members

export interface TitledMember extends OutlineMember {
  title: string | null;
  role?: string;
}

const TOP = /^(?:co-?)?(?:president|chair(?:person)?|captain|ceo|executive director|founder)\b/i;
const LEAD_TITLE = /\b(?:vice|vp|head|director|lead|chief|treasurer|secretary|officer|manager|chair)\b/i;
const ADVISOR = /advis/i;
const STOP = new Set(["of", "and", "the", "for", "vp", "head", "lead", "director", "chair", "vice", "president", "manager", "officer", "&"]);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/**
 * A first outline from the titles members already have: the top title
 * (President, Chair, Captain...) at the top, advisors beside it, leads
 * (VP, Head, Director, Treasurer...) under it, and everyone else under the
 * lead whose title shares a word with theirs ("Head of Programs" under
 * "VP Ops & Programs"), or under the top. Members without a title (or
 * titled just "Member") are left for the tray.
 */
export function draftFromMembers(members: readonly TitledMember[]): string {
  const titled = members
    .filter((m) => m.title && m.title.trim() && !/^members?$/i.test(m.title.trim()))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const isTop = (m: TitledMember) => TOP.test(m.title!.trim()) && !/vice|vp/i.test(m.title!) && !ADVISOR.test(m.title!);
  const ownerFirst = [...titled].sort((a, b) => Number(b.role === "OWNER") - Number(a.role === "OWNER"));
  const top = ownerFirst.find(isTop) ?? null;
  const rest = titled.filter((m) => m !== top);
  const advisors = rest.filter((m) => ADVISOR.test(m.title!));
  const leads = rest.filter((m) => !advisors.includes(m) && (LEAD_TITLE.test(m.title!) || isTop(m)));
  const others = rest.filter((m) => !advisors.includes(m) && !leads.includes(m));

  const line = (m: TitledMember, depth: number, advisor = false) =>
    `${"  ".repeat(depth)}${advisor ? "Advisor: " : ""}${m.title!.trim()} — @${m.name ?? "Member"}`;
  const base = top ? 1 : 0;
  const out: string[] = [];
  if (top) out.push(line(top, 0));
  for (const a of advisors) out.push(line(a, base, true));
  const under = new Map<TitledMember, TitledMember[]>();
  const loose: TitledMember[] = [];
  for (const o of others) {
    const w = words(o.title!);
    let best: TitledMember | null = null;
    let score = 0;
    for (const l of leads) {
      const shared = [...words(l.title!)].filter((x) => w.has(x)).length;
      if (shared > score) {
        best = l;
        score = shared;
      }
    }
    if (best) under.set(best, [...(under.get(best) ?? []), o]);
    else loose.push(o);
  }
  for (const l of leads) {
    out.push(line(l, base));
    for (const o of under.get(l) ?? []) out.push(line(o, base + 1));
  }
  for (const o of loose) out.push(line(o, base));
  return out.join("\n");
}
