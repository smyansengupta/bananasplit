import { cleanText } from "@/lib/org-chart/text";

import { isFieldLine } from "./fields";

/**
 * The line model the built-in parser works on: every line of the document
 * with its indent, its bullet or tree marker and what kind of line it is.
 * Segmentation happens once, here, so the shape readers (sections, outline,
 * table, diagram) all agree about which lines they are allowed to consume
 * and which lines are left over for the confidence report.
 */

export type LineKind =
  | "blank"
  | "fence"
  | "rule"
  | "diagram"
  | "table"
  | "heading"
  | "field"
  | "bullet"
  | "text";

export interface DocLine {
  /** 0-based line number in the cleaned document. */
  index: number;
  raw: string;
  /** Trimmed, with the bullet or tree marker removed. */
  text: string;
  /** Leading whitespace in columns (a tab is four), plus tree-connector width. */
  indent: number;
  /** The bullet or tree marker this line started with, if any. */
  marker: string | null;
  /** Markdown heading level, 1-6, or 0. */
  headingLevel: number;
  kind: LineKind;
  /** True once a shape reader has taken this line. */
  used: boolean;
}

/** Characters that draw a tree or a box, never part of a word. */
export const CONNECTOR_CHARS = "|+-─│┌┐└┘├┤┬┴┼═║╚╝╠╣╦╩╬╱╲╴╶╷╹→└┣┗┃━";
const CONNECTOR_SET = new Set(CONNECTOR_CHARS.split(""));

const BULLET_MARKER = /^([-*•·▪◦–—+>]+|\d+[.)]|[a-z][.)])\s+/;
const TREE_MARKER = new RegExp(`^([${CONNECTOR_CHARS.replace(/[-\\\]]/g, "\\$&")}\\s]*[${CONNECTOR_CHARS.replace(/[-\\\]]/g, "\\$&")}])\\s+`);

export function expandTabs(raw: string, width = 4): string {
  let out = "";
  for (const ch of raw) {
    if (ch === "\t") out += " ".repeat(width - (out.length % width));
    else out += ch;
  }
  return out;
}

/** True for a run of characters that only draws lines (never a lone "+" or "-"). */
export function isConnectorRun(run: string): boolean {
  if (!run) return false;
  for (const ch of run) if (!CONNECTOR_SET.has(ch)) return false;
  if (run.length === 1) return run === "|" || run === "│" || run === "┃";
  return true;
}

/** How much of a line is drawing rather than writing, 0 to 1. */
export function connectorDensity(raw: string): number {
  const text = raw.trim();
  if (!text) return 0;
  let drawn = 0;
  for (const run of text.split(/\s+/)) if (isConnectorRun(run)) drawn += run.length;
  return drawn / text.replace(/\s+/g, "").length;
}

function headingLevel(raw: string): number {
  const match = raw.trimStart().match(/^(#{1,6})\s+\S/);
  return match ? match[1].length : 0;
}

/**
 * A markdown table row (pipes on both ends) or a tab-separated row. A line
 * that merely contains pipes is not one: a drawn tree is full of them.
 */
export function isTableRow(raw: string): boolean {
  const text = raw.trim();
  if (text.startsWith("|") && text.endsWith("|") && text.length > 2) return true;
  return /\t/.test(raw) && raw.split("\t").filter((c) => c.trim()).length >= 2;
}

export function isTableDivider(raw: string): boolean {
  const text = raw.trim().replace(/^\||\|$/g, "");
  if (!text.includes("-")) return false;
  return text.split("|").every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell));
}

/**
 * Splits the document into lines and labels each one. Diagram blocks are
 * runs of at least two lines that are mostly drawing; table blocks are runs
 * of at least two rows sharing a column separator. Fenced code keeps its
 * contents (a club's chart is often inside a fence), but the fence markers
 * themselves are structural.
 */
export function readDocument(input: string): DocLine[] {
  const raws = cleanText(input).split("\n").map((l) => expandTabs(l.replace(/\s+$/, "")));
  const lines: DocLine[] = raws.map((raw, index) => {
    const trimmed = raw.trim();
    let rest = raw.replace(/^\s*/, "");
    let indent = raw.length - rest.length;
    let marker: string | null = null;

    const tree = rest.match(TREE_MARKER);
    if (tree && isConnectorRun(tree[1].replace(/\s/g, "")) && tree[1].replace(/\s/g, "").length >= 2) {
      marker = tree[1].trim();
      indent += tree[0].length;
      rest = rest.slice(tree[0].length);
    }
    const bullet = rest.match(BULLET_MARKER);
    if (bullet) {
      marker = marker ? `${marker}${bullet[1]}` : bullet[1];
      indent += bullet[0].length;
      rest = rest.slice(bullet[0].length);
    }

    const level = headingLevel(raw);
    const text = level > 0 ? trimmed.replace(/^#{1,6}\s+/, "").replace(/\s+#+$/, "") : rest.trim();

    let kind: LineKind = "text";
    if (!trimmed) kind = "blank";
    else if (/^(```|~~~)/.test(trimmed)) kind = "fence";
    else if (/^([-*_=—─])\1{2,}$/.test(trimmed.replace(/\s/g, ""))) kind = "rule";
    // A line that is nothing but drawing ("|", "+-----+") carries no text.
    else if (trimmed.split(/\s+/).every((run) => isConnectorRun(run))) kind = "rule";
    else if (level > 0) kind = "heading";
    else if (marker) kind = "bullet";

    return { index, raw, text, indent, marker, headingLevel: level, kind, used: false };
  });

  markTables(lines);
  markDiagrams(lines);
  for (const line of lines) {
    if (line.kind === "text" || line.kind === "bullet") {
      if (isFieldLine(line.text)) line.kind = "field";
    }
  }
  return lines;
}

/**
 * The number of separate labels on one line: two or more means the line
 * holds boxes side by side, which is what tells a drawn diagram apart from
 * a drawn tree (a tree has one label per line, and the outline reader
 * handles it better).
 */
export function labelsOnLine(raw: string): number {
  let labels = 0;
  let previousEnd = -99;
  let open = false;
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    if (isConnectorRun(match[0])) {
      open = false;
      continue;
    }
    if (!open || match.index - previousEnd >= 3) labels++;
    open = true;
    previousEnd = match.index + match[0].length;
  }
  return labels;
}

/** Runs of at least two mostly-drawn lines become one diagram block. */
function markDiagrams(lines: DocLine[]): void {
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    // Only a drawing with boxes beside one another is a diagram.
    const sideBySide = lines.slice(start, end).some((l) => labelsOnLine(l.raw) >= 2);
    if (end - start >= 2 && sideBySide) {
      for (let i = start; i < end; i++) if (lines[i].kind !== "blank") lines[i].kind = "diagram";
    }
    start = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === "fence" || line.kind === "heading" || line.kind === "table") {
      close(i);
      continue;
    }
    const drawn = connectorDensity(line.raw) >= 0.5 && line.raw.trim().length >= 2;
    if (drawn) {
      if (start < 0) start = i;
      continue;
    }
    // A text line inside a diagram block keeps it open; two blanks close it.
    if (start >= 0 && line.kind === "blank" && (lines[i + 1]?.kind === "blank" || i + 1 >= lines.length)) close(i);
    else if (start >= 0 && line.kind === "blank" && connectorDensity(lines[i + 1]?.raw ?? "") < 0.5) close(i);
  }
  close(lines.length);
  // Pull the surrounding label rows of a diagram into the block.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== "diagram") continue;
    for (let j = i - 1; j >= 0 && lines[j].kind !== "blank" && lines[j].kind !== "heading" && lines[j].kind !== "fence" && lines[j].kind !== "diagram"; j--) {
      lines[j].kind = "diagram";
    }
    while (i + 1 < lines.length && lines[i + 1].kind !== "blank" && lines[i + 1].kind !== "heading" && lines[i + 1].kind !== "fence") {
      i++;
      lines[i].kind = "diagram";
    }
  }
}

/** A tree guide ("|   |   - ...") has pipes but is not a table row. */
function tableCandidate(line: DocLine): boolean {
  if (line.kind === "diagram" || line.kind === "blank" || line.kind === "fence") return false;
  // A "| --- | --- |" separator reads as pure drawing but belongs to its table.
  if (line.kind === "rule") return isTableRow(line.raw) && isTableDivider(line.raw);
  if (line.marker && isConnectorRun(line.marker.replace(/\s/g, ""))) return false;
  return isTableRow(line.raw);
}

function markTables(lines: DocLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    if (!tableCandidate(lines[i])) continue;
    let end = i;
    while (end < lines.length && tableCandidate(lines[end])) end++;
    if (end - i >= 2) for (let j = i; j < end; j++) lines[j].kind = "table";
    i = Math.max(i, end - 1);
  }
}

/** Row cells of a pipe or tab separated row. */
export function tableCells(raw: string): string[] {
  const text = raw.trim();
  if (text.includes("|")) {
    return text
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  }
  return raw.split("\t").map((c) => c.trim());
}

/** Contiguous runs of lines of one kind, as [start, end) index pairs. */
export function blocksOfKind(lines: readonly DocLine[], kind: LineKind): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const match = i < lines.length && lines[i].kind === kind;
    if (match && start < 0) start = i;
    if (!match && start >= 0) {
      blocks.push([start, i]);
      start = -1;
    }
  }
  return blocks;
}
