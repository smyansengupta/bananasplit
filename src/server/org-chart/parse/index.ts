import type { OrgChartParse, RawPosition } from "@/lib/org-chart/schema";
import { clamp, cleanLine, foldCase } from "@/lib/org-chart/text";
import type { ParseReport, ParseShape } from "@/lib/org-chart/types";

import { readDiagram } from "./diagram";
import { blocksOfKind, isTableDivider, readDocument, tableCells, type DocLine } from "./document";
import {
  decisionsFromBullet,
  isNoneValue,
  looksLikeTitle,
  matchFieldLabel,
  parseFieldLine,
  parseRoleLine,
  sentenceCase,
  splitList,
  type FieldName,
  type RoleLine,
} from "./fields";

/**
 * The built-in org-chart parser: a deterministic reader for the document
 * shapes a student club actually writes. It needs no API key, costs
 * nothing, and runs in the upload request.
 *
 * Shapes, in the order they are tried:
 *   sections  a heading or "Title: Person" line per role, with
 *             "Reports to: / Manages: / Advisor: / Decides alone:" lines and
 *             bullets underneath; markdown heading levels give the
 *             hierarchy when no reporting line does.
 *   table     a "Name | Title | Reports to" table (extra columns for
 *             responsibilities and decisions are used when present).
 *   outline   an indented outline or a drawn tree ("|--", "├──"), where
 *             indentation gives the hierarchy and deeper lines are bullets.
 *   diagram   a multi-column ASCII box diagram (see diagram.ts).
 * The reader that finds the most positions wins, ties going to the shape
 * higher in that list.
 *
 * The output is exactly the shape the Claude path returns, so it goes
 * through the same normalizeOrgChart() afterwards: canonical reports_to,
 * recomputed manages, cycle and dangling detection and the advisor rules.
 * Open items are never invented here - the parser reports the lines it
 * could not place instead, which is what an admin can actually act on.
 */

export type { ParseReport, ParseShape } from "@/lib/org-chart/types";

export interface BuiltinParse {
  parse: OrgChartParse;
  report: ParseReport;
}

/**
 * At or above this, the built-in parse becomes the draft on its own. Below
 * it, Claude Haiku is asked to read the document instead (when the org has
 * a key); the built-in result is still what the admin gets if it cannot be.
 */
export const BUILTIN_CONFIDENCE_THRESHOLD = 0.7;

const MAX_ORPHAN_LINES = 20;
const MAX_ORPHAN_LENGTH = 160;
const MAX_POSITIONS = 200;

interface Draft {
  id: string;
  title: string;
  personName: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  /** A reference (id, title, or person name) resolved by normalizeOrgChart. */
  reportsTo: string | null;
  manages: string[];
  advisorRefs: string[];
  responsibilities: string[];
  decidesAlone: string[];
  hasDecidesField: boolean;
  sourceQuote: string[];
  /** Set when the shape gave the parent directly rather than by name. */
  parentId: string | null;
}

class Builder {
  readonly drafts: Draft[] = [];
  private n = 0;

  add(role: RoleLine, quote: string[]): Draft {
    const draft: Draft = {
      id: `p${++this.n}`,
      title: role.title,
      personName: role.personName,
      isOpen: role.isOpen,
      isAdvisor: role.isAdvisor,
      reportsTo: null,
      manages: [],
      advisorRefs: [],
      responsibilities: [],
      decidesAlone: [],
      hasDecidesField: false,
      sourceQuote: quote.filter(Boolean).slice(0, 3),
      parentId: null,
    };
    this.drafts.push(draft);
    return draft;
  }
}

/** Applies one labelled field to the position it belongs to. */
function applyField(draft: Draft, field: FieldName, value: string): void {
  switch (field) {
    case "reportsTo":
      if (!isNoneValue(value)) draft.reportsTo = cleanLine(value);
      break;
    case "manages":
      draft.manages.push(...splitList(value));
      break;
    case "advisor":
      draft.advisorRefs.push(...splitList(value));
      break;
    case "decidesAlone":
      draft.hasDecidesField = true;
      draft.decidesAlone.push(...splitList(value).map(sentenceCase));
      break;
    case "responsibilities":
      draft.responsibilities.push(...splitList(value).map(sentenceCase));
      break;
    case "person": {
      const role = parseRoleLine(`X: ${value}`);
      if (role?.isOpen) draft.isOpen = true;
      else if (!isNoneValue(value)) draft.personName = cleanLine(value);
      break;
    }
    case "title":
      if (!isNoneValue(value) && looksLikeTitle(value)) draft.title = cleanLine(value);
      break;
    case "status":
      if (/open|vacan|hiring|unfilled|tbd|tba/i.test(value)) draft.isOpen = true;
      break;
  }
}

const STRUCTURAL: ReadonlySet<FieldName> = new Set(["reportsTo", "manages", "advisor", "person", "title"]);

// ------------------------------------------------------------------ sections

interface SectionOptions {
  /** Accept a heading as a role even when it names nobody. */
  acceptBareHeadings: boolean;
}

function isStructuralFieldLine(line: DocLine | undefined): boolean {
  if (!line || line.kind !== "field") return false;
  return parseFieldLine(line.text).some((c) => STRUCTURAL.has(c.field));
}

function nextContentLine(lines: readonly DocLine[], from: number): DocLine | undefined {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].kind === "blank" || lines[i].kind === "rule" || lines[i].kind === "fence") continue;
    return lines[i];
  }
  return undefined;
}

function readSections(lines: DocLine[], options: SectionOptions): Draft[] {
  const builder = new Builder();
  const openHeads: Array<{ level: number; draft: Draft }> = [];
  let current: Draft | null = null;
  let currentLevel = 0;
  let currentIndent = 0;

  const isHead = (line: DocLine, at: number): RoleLine | null => {
    if (line.kind !== "heading" && line.kind !== "text") return null;
    const role = parseRoleLine(line.text);
    if (!role) return null;
    const named = role.personName !== null || role.isOpen || role.isAdvisor;
    if (line.kind === "heading") {
      if (named || options.acceptBareHeadings) return role;
      // A heading followed by a reporting line is a role even unnamed.
      for (let i = at + 1; i < lines.length; i++) {
        if (lines[i].kind === "heading") break;
        if (lines[i].kind === "blank" || lines[i].kind === "rule" || lines[i].kind === "fence") continue;
        if (isStructuralFieldLine(lines[i])) return role;
        if (lines[i].kind === "text") break;
      }
      return null;
    }
    // A plain line is a role only when a reporting line follows it.
    return isStructuralFieldLine(nextContentLine(lines, at + 1)) ? role : null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === "blank" || line.kind === "fence" || line.kind === "rule" || line.kind === "diagram") continue;

    const head = isHead(line, i);
    if (head) {
      const level = line.headingLevel || 0;
      while (openHeads.length > 0 && openHeads[openHeads.length - 1].level >= level) openHeads.pop();
      const quote = [line.raw.trim()];
      const field = nextContentLine(lines, i + 1);
      if (field && field.kind === "field") quote.push(field.raw.trim());
      current = builder.add(head, quote);
      currentLevel = level;
      currentIndent = line.indent;
      if (level > 0) {
        current.parentId = openHeads[openHeads.length - 1]?.draft.id ?? null;
        openHeads.push({ level, draft: current });
      }
      line.used = true;
      continue;
    }

    if (!current) continue;
    if (line.kind === "heading" && line.headingLevel <= currentLevel && currentLevel > 0) {
      current = null;
      continue;
    }
    if (line.kind === "field") {
      for (const chunk of parseFieldLine(line.text)) applyField(current, chunk.field, chunk.value);
      line.used = true;
      continue;
    }
    if (line.kind === "bullet") {
      current.responsibilities.push(cleanLine(line.text));
      line.used = true;
      continue;
    }
    // A fresh unindented paragraph starts a new topic: it ends this role's
    // block rather than swallowing whatever follows it.
    if (line.kind === "text" && line.indent <= currentIndent) current = null;
  }
  return builder.drafts;
}

/** Heading levels only give the hierarchy when no reporting line does. */
function applyHeadingParents(drafts: readonly Draft[]): void {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  for (const draft of drafts) {
    if (draft.reportsTo || !draft.parentId) continue;
    const parent = byId.get(draft.parentId);
    if (parent) draft.reportsTo = parent.id;
  }
}

// ------------------------------------------------------------------ table

const COLUMN_ALIASES: Record<string, FieldName | "title"> = {
  name: "person",
  person: "person",
  who: "person",
  member: "person",
  lead: "person",
  title: "title",
  role: "title",
  position: "title",
};

function columnField(header: string): FieldName | null {
  const folded = foldCase(header).replace(/[^a-z]/g, "");
  if (!folded) return null;
  const alias = COLUMN_ALIASES[folded];
  if (alias) return alias === "title" ? "title" : alias;
  return matchFieldLabel(header);
}

/** A table cell holding a list: only semicolons separate items, so commas stay inside one. */
function splitCell(value: string): string[] {
  return value
    .split(/\s*;\s*|\s*<br\s*\/?>\s*/i)
    .map((v) => cleanLine(v))
    .filter((v) => v.length > 0 && !isNoneValue(v));
}

function readTables(lines: DocLine[]): Draft[] {
  const builder = new Builder();
  for (const [start, end] of blocksOfKind(lines, "table")) {
    const rows: DocLine[] = [];
    for (let i = start; i < end; i++) {
      if (isTableDivider(lines[i].raw)) {
        lines[i].used = true;
        continue;
      }
      rows.push(lines[i]);
    }
    if (rows.length < 2) continue;
    const headers = tableCells(rows[0].raw).map(columnField);
    const named = headers.filter(Boolean).length;
    if (named < 2 || !headers.includes("title")) continue;
    rows[0].used = true;
    for (const row of rows.slice(1)) {
      const cells = tableCells(row.raw);
      const titleAt = headers.indexOf("title");
      const rawTitle = cells[titleAt] ?? "";
      const role = parseRoleLine(rawTitle);
      if (!role) continue;
      const draft = builder.add(role, [row.raw.trim()]);
      headers.forEach((field, column) => {
        const value = cells[column];
        if (!field || field === "title" || value === undefined || !value.trim()) return;
        if (field === "responsibilities" || field === "decidesAlone") {
          const items = splitCell(value);
          if (field === "responsibilities") draft.responsibilities.push(...items);
          else {
            draft.hasDecidesField = true;
            draft.decidesAlone.push(...items.map(sentenceCase));
          }
          return;
        }
        applyField(draft, field, value);
      });
      row.used = true;
    }
  }
  return builder.drafts;
}

// ------------------------------------------------------------------ outline

interface OutlineCandidate {
  line: DocLine;
  role: RoleLine;
  strong: boolean;
}

function readOutline(lines: DocLine[]): Draft[] {
  const builder = new Builder();
  const regions: DocLine[][] = [];
  let region: DocLine[] = [];
  let gap = 0;
  for (const line of lines) {
    // A drawing-only line ("|", "|   |") is the tree's guide, not a break.
    if (line.kind === "rule") continue;
    if (line.kind === "heading" || line.kind === "table" || line.kind === "diagram" || line.kind === "fence") {
      if (region.length > 0) regions.push(region);
      region = [];
      gap = 0;
      continue;
    }
    if (line.kind === "blank") {
      if (++gap > 1 && region.length > 0) {
        regions.push(region);
        region = [];
      }
      continue;
    }
    gap = 0;
    region.push(line);
  }
  if (region.length > 0) regions.push(region);

  for (const block of regions) {
    const candidates: OutlineCandidate[] = [];
    for (const line of block) {
      if (line.kind === "field") continue;
      const role = parseRoleLine(line.text);
      if (!role) continue;
      const strong =
        role.personName !== null ||
        role.isOpen ||
        role.via === "marker" ||
        /^\s*(\*\*|__)/.test(line.text) ||
        isStructuralFieldLine(nextContentLine(block, block.indexOf(line) + 1));
      candidates.push({ line, role, strong });
    }
    const strongOnes = candidates.filter((c) => c.strong);
    if (strongOnes.length < 2) continue;
    const strongIndents = new Set(strongOnes.map((c) => c.line.indent));
    const roleLines = new Map<number, OutlineCandidate>();
    for (const candidate of candidates) {
      // A line that names nobody is a position only where the outline
      // already puts positions and it has lines of its own underneath;
      // otherwise it is a bullet, and inventing a box from prose is worse
      // than leaving it as one.
      const nested = () => {
        const at = block.indexOf(candidate.line);
        const next = block[at + 1];
        return next !== undefined && next.indent > candidate.line.indent;
      };
      if (candidate.strong || (strongIndents.has(candidate.line.indent) && nested())) {
        roleLines.set(candidate.line.index, candidate);
      }
    }
    if (roleLines.size < 2) continue;

    const stack: Array<{ indent: number; draft: Draft }> = [];
    let current: { indent: number; draft: Draft } | null = null;
    for (const line of block) {
      const candidate = roleLines.get(line.index);
      if (candidate) {
        while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) stack.pop();
        const draft = builder.add(candidate.role, [line.raw.trim()]);
        draft.parentId = stack[stack.length - 1]?.draft.id ?? null;
        stack.push({ indent: line.indent, draft });
        current = { indent: line.indent, draft };
        line.used = true;
        continue;
      }
      if (!current) continue;
      if (line.kind === "field") {
        for (const chunk of parseFieldLine(line.text)) applyField(current.draft, chunk.field, chunk.value);
        line.used = true;
        continue;
      }
      // Only a line written underneath a position belongs to it: a
      // paragraph back at its own level is a new topic, not a bullet.
      if (line.indent <= current.indent) {
        current = null;
        continue;
      }
      current.draft.responsibilities.push(cleanLine(line.text));
      line.used = true;
    }
  }
  return builder.drafts;
}

// ------------------------------------------------------------------ diagram

function readDiagrams(lines: DocLine[]): Draft[] {
  const builder = new Builder();
  for (const [start, end] of blocksOfKind(lines, "diagram")) {
    const raws = lines.slice(start, end).map((l) => l.raw);
    const { nodes, edges } = readDiagram(raws);
    const drafts = new Map<number, Draft>();
    for (const node of nodes) {
      // A box often names its person on the next line ("VP Growth" over
      // "(Lucas)"): fold that line into the label rather than losing it.
      let label = node.label;
      let extra = node.extra;
      let role = parseRoleLine(label);
      if (extra.length > 0 && !(role?.personName || role?.isOpen)) {
        const joined = parseRoleLine(`${label} ${extra[0]}`);
        if (joined && (joined.personName || joined.isOpen)) {
          label = `${label} ${extra[0]}`;
          extra = extra.slice(1);
          role = joined;
        }
      }
      if (!role) continue;
      const draft = builder.add(role, [label]);
      for (const line of extra) {
        const text = cleanLine(line.replace(/^[+\-*•]\s*/, ""));
        if (text) draft.responsibilities.push(text);
      }
      drafts.set(node.id, draft);
    }
    if (drafts.size < 2) {
      for (const draft of drafts.values()) builder.drafts.splice(builder.drafts.indexOf(draft), 1);
      continue;
    }
    for (const edge of edges) {
      const child = drafts.get(edge.child);
      const parent = drafts.get(edge.parent);
      if (child && parent && !child.parentId) child.parentId = parent.id;
    }
    for (let i = start; i < end; i++) lines[i].used = true;
  }
  return builder.drafts;
}

// ------------------------------------------------------------------ assembly

/** Resolves a reference to one draft: id, then title, then person name, then a unique first name. */
function resolveRef(ref: string, drafts: readonly Draft[]): Draft | undefined {
  const folded = foldCase(cleanLine(ref));
  if (!folded) return undefined;
  const byId = drafts.find((d) => d.id === ref);
  if (byId) return byId;
  const unique = (list: Draft[]) => (list.length === 1 ? list[0] : undefined);
  return (
    unique(drafts.filter((d) => foldCase(d.title) === folded)) ??
    unique(drafts.filter((d) => d.personName !== null && foldCase(d.personName) === folded)) ??
    (/\s/.test(folded)
      ? undefined
      : unique(drafts.filter((d) => d.personName !== null && foldCase(d.personName).split(/\s+/)[0] === folded)))
  );
}

function finishDrafts(drafts: Draft[]): void {
  for (const draft of drafts) {
    if (!draft.reportsTo && draft.parentId) draft.reportsTo = draft.parentId;
    if (!draft.hasDecidesField) {
      for (const bullet of draft.responsibilities) draft.decidesAlone.push(...decisionsFromBullet(bullet));
    }
    for (const ref of draft.advisorRefs) {
      const target = resolveRef(ref, drafts);
      if (target && target !== draft) {
        target.isAdvisor = true;
        if (!target.reportsTo) target.reportsTo = draft.id;
      }
    }
  }
}

function toRawPositions(drafts: readonly Draft[]): RawPosition[] {
  return drafts.slice(0, MAX_POSITIONS).map((d) => ({
    id: d.id,
    title: d.title,
    person_name: d.personName,
    reports_to: d.reportsTo,
    manages: d.manages,
    responsibilities: d.responsibilities,
    decides_alone: d.decidesAlone,
    is_open: d.isOpen,
    is_advisor: d.isAdvisor,
    source_quote: d.sourceQuote,
  }));
}

function countRoots(drafts: readonly Draft[]): { roots: number; linked: number } {
  let roots = 0;
  let linked = 0;
  for (const draft of drafts) {
    if (!draft.reportsTo) {
      roots++;
      continue;
    }
    if (resolveRef(draft.reportsTo, drafts)) linked++;
  }
  return { roots, linked };
}

/**
 * How much of the document the parser understood, as one number:
 *
 *   coverage   the share of content lines it placed somewhere (0.4)
 *   linkage    the share of positions with a manager, allowing exactly one
 *              position with none (0.4)
 *   identified the share of positions with a person or an open-hire mark (0.2)
 *
 * Fewer than two positions scores zero: one box is not a chart.
 */
export function scoreConfidence(input: {
  positions: number;
  identified: number;
  linked: number;
  roots: number;
  linesConsidered: number;
  linesUsed: number;
}): number {
  if (input.positions < 2) return 0;
  const coverage = input.linesConsidered === 0 ? 1 : input.linesUsed / input.linesConsidered;
  const connected = input.linked + Math.min(1, input.roots);
  const linkage = Math.min(1, connected / input.positions);
  const identified = input.identified / input.positions;
  const score = 0.4 * coverage + 0.4 * linkage + 0.2 * identified;
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

interface Attempt {
  shape: ParseShape;
  drafts: Draft[];
  marks: boolean[];
  confidence: number;
  measures: ReturnType<typeof measure>;
}

function measure(drafts: readonly Draft[], lines: readonly DocLine[], marks: readonly boolean[]) {
  let considered = 0;
  let used = 0;
  const orphans: DocLine[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.kind === "blank" || line.kind === "fence" || line.kind === "rule") continue;
    considered++;
    if (marks[i]) used++;
    else orphans.push(line);
  }
  const { roots, linked } = countRoots(drafts);
  const identified = drafts.filter((d) => d.personName !== null || d.isOpen).length;
  return { considered, used, orphans, roots, linked, identified, positions: drafts.length };
}

/**
 * Reads a plain-text or markdown document into the same parse shape the
 * Claude path produces, with a report of what it understood. Never throws.
 */
export function parseOrgChartText(input: string): BuiltinParse {
  const notes: string[] = [];
  const lines = readDocument(input);

  // Every shape reader runs on its own copy of the line marks, so the one
  // that wins decides which lines count as understood.
  const raw: Array<{ shape: ParseShape; drafts: Draft[]; marks: boolean[] }> = [];
  const run = (shape: ParseShape, reader: (l: DocLine[]) => Draft[]) => {
    for (const line of lines) line.used = false;
    const drafts = reader(lines);
    raw.push({ shape, drafts, marks: lines.map((l) => l.used) });
  };

  run("sections", (l) => {
    const drafts = readSections(l, { acceptBareHeadings: false });
    applyHeadingParents(drafts);
    return drafts;
  });
  if (raw[0].drafts.length < 2) {
    run("sections", (l) => {
      const drafts = readSections(l, { acceptBareHeadings: true });
      applyHeadingParents(drafts);
      return drafts;
    });
  }
  run("table", readTables);
  run("outline", readOutline);
  run("diagram", readDiagrams);

  // A diagram that was read is understood even when the positions came from
  // somewhere better: its lines are never orphans.
  const diagramMarks = raw.find((a) => a.shape === "diagram" && a.drafts.length >= 2)?.marks;
  if (diagramMarks) for (const attempt of raw) attempt.marks = attempt.marks.map((m, i) => m || diagramMarks[i]);

  const attempts: Attempt[] = raw.map((attempt) => {
    const drafts = attempt.drafts.slice(0, MAX_POSITIONS);
    finishDrafts(drafts);
    const measures = measure(drafts, lines, attempt.marks);
    return {
      ...attempt,
      drafts,
      measures,
      confidence: scoreConfidence({ ...measures, linesConsidered: measures.considered, linesUsed: measures.used }),
    };
  });

  // The best-understood reading wins; an equal reading goes to the shape
  // that was tried first (sections, then table, outline and diagram).
  let best = attempts[0];
  for (const attempt of attempts) if (attempt.confidence > best.confidence + 0.0005) best = attempt;

  const drafts = best.drafts;
  if (best.drafts.length >= MAX_POSITIONS) {
    notes.push(`Only the first ${MAX_POSITIONS} positions in this document were kept.`);
  }

  const { orphans, roots, linked, identified } = best.measures;
  const confidence = best.confidence;
  const considered = { length: best.measures.considered };

  if (drafts.length === 0) notes.push("No positions were found in this document.");
  else if (roots > 1) notes.push(`${roots} positions have nobody above them. Check who they report to.`);
  if (orphans.length > 0) {
    notes.push(`${orphans.length} line${orphans.length === 1 ? "" : "s"} could not be placed under a position.`);
  }

  return {
    parse: { positions: toRawPositions(drafts), open_items: [] },
    report: {
      shape: drafts.length === 0 ? "none" : best.shape,
      confidence,
      positions: drafts.length,
      identified,
      linked,
      roots,
      linesConsidered: considered.length,
      linesUsed: best.measures.used,
      orphanCount: orphans.length,
      orphanLines: orphans.slice(0, MAX_ORPHAN_LINES).map((l) => clamp(cleanLine(l.raw), MAX_ORPHAN_LENGTH)),
      notes,
    },
  };
}
