import { isOpenMarker } from "@/lib/org-chart/normalize";
import { cleanLine, foldCase } from "@/lib/org-chart/text";

/**
 * The vocabulary of the built-in parser: the labelled lines a student club
 * writes ("Reports to: Jackson", "Manages: Alex, Smyan", "Decides alone:
 * deadlines"), the role lines that name a position and its person
 * ("VP Growth — Lucas Salzgeber", "Graphic Designer [OPEN HIRE]") and the
 * small list and casing helpers both need.
 *
 * Everything here is pure, bounded and case-insensitive, and every label is
 * matched with one edit of slack so "Reports To", "Reports-to" and a typo'd
 * "Reprots to" all land on the same field.
 */

export type FieldName =
  | "reportsTo"
  | "manages"
  | "advisor"
  | "decidesAlone"
  | "responsibilities"
  | "person"
  | "title"
  | "status";

/** Canonical label spellings, folded to letters only for matching. */
const LABELS: Record<FieldName, readonly string[]> = {
  reportsTo: ["reportsto", "reportto", "reportingto", "reportsinto", "reportsupto", "manager", "managedby", "supervisor", "reportsdirectlyto", "under"],
  manages: ["manages", "manage", "managing", "directreports", "reports", "oversees", "supervises", "leads", "team"],
  advisor: ["advisor", "adviser", "advisors", "advisers", "advises", "advisedby"],
  decidesAlone: ["decidesalone", "decidealone", "decides", "decidessolo", "decisionrights", "decisions", "ownsdecisions", "finalsay", "hasfinalsay", "signsoff", "approves", "canapprove"],
  responsibilities: ["responsibilities", "responsibility", "responsiblefor", "owns", "duties", "scope", "does", "whattheydo"],
  person: ["person", "name", "who", "heldby", "filledby", "lead", "holder", "incumbent"],
  title: ["title", "role", "position"],
  status: ["status", "vacancy", "hiring"],
};

/** A label's letters, lowercased: "Reports to:" -> "reportsto". */
export function foldLabel(raw: string): string {
  return foldCase(raw).replace(/[^a-z]/g, "");
}

/**
 * Edit distance counting a swap of two neighbours as one mistake, so the
 * common typo "Reprots to" is one edit from "Reports to". Capped at `max`
 * (anything further returns max + 1).
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let twoBack: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The field a label names, or null. Exact first, then one edit of slack for
 * labels of at least five letters ("Reprots to" -> reportsTo), so a typo
 * does not silently drop a reporting line.
 */
export function matchFieldLabel(raw: string): FieldName | null {
  const folded = foldLabel(raw);
  if (!folded || folded.length > 24) return null;
  for (const [field, spellings] of Object.entries(LABELS) as [FieldName, readonly string[]][]) {
    if (spellings.includes(folded)) return field;
  }
  if (folded.length < 5) return null;
  let best: { field: FieldName; distance: number } | null = null;
  for (const [field, spellings] of Object.entries(LABELS) as [FieldName, readonly string[]][]) {
    for (const spelling of spellings) {
      if (spelling.length < 5) continue;
      const distance = editDistance(folded, spelling, 1);
      if (distance <= 1 && (!best || distance < best.distance)) best = { field, distance };
    }
  }
  return best?.field ?? null;
}

export interface FieldChunk {
  field: FieldName;
  label: string;
  value: string;
}

/** Separators a club uses to put several fields on one line. */
const CHUNK_SPLIT = /\s+[·•|]\s+|\s{2,}\|\s{2,}|\s+•\s+/;

/**
 * The fields on one line. "Reports to: N/A · Manages: Oliver, Lucas ·
 * Advisor: Mehr" gives three chunks; a line with no recognized label gives
 * none. Only the first colon of a chunk splits it, so a value may contain
 * colons.
 */
export function parseFieldLine(line: string): FieldChunk[] {
  const text = cleanLine(line).replace(/^[-*•·–—]+\s+/, "");
  if (!text) return [];
  const chunks: FieldChunk[] = [];
  for (const part of text.split(CHUNK_SPLIT)) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const label = part.slice(0, at).trim().replace(/^\*\*|\*\*$/g, "").replace(/^__|__$/g, "");
    const field = matchFieldLabel(label);
    if (!field) continue;
    chunks.push({ field, label, value: part.slice(at + 1).trim() });
  }
  return chunks;
}

/** True when the whole line is nothing but recognized field chunks. */
export function isFieldLine(line: string): boolean {
  const chunks = parseFieldLine(line);
  if (chunks.length === 0) return false;
  const text = cleanLine(line).replace(/^[-*•·–—]+\s+/, "");
  const covered = chunks.reduce((n, c) => n + c.label.length + c.value.length + 1, 0);
  return covered >= text.length - 4 * chunks.length;
}

const NONE = /^(n\/?a|none|nobody|no one|tbd|tba|-+|—|–|—|null|not applicable|top|top of the chart)\.?$/i;

/** A field value that means "nothing here". */
export function isNoneValue(value: string): boolean {
  return !value.trim() || NONE.test(value.trim());
}

/**
 * A comma, semicolon or "and" list: "Oliver, Lucas, Anthony" -> three.
 * "&" never splits, because titles use it ("Social & Membership").
 */
export function splitList(value: string): string[] {
  const text = cleanLine(value);
  if (!text || isNoneValue(text)) return [];
  const parts = /[,;]/.test(text) ? text.split(/[,;]/) : text.split(/\s+\band\b\s+/i);
  return parts
    .map((p) => p.replace(/^\s*(?:and|&)\s+/i, "").replace(/\.$/, "").trim())
    .filter((p) => p.length > 0 && !isNoneValue(p));
}

/** "board changes" -> "Board changes"; an already-capitalized item is left alone. */
export function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

// ------------------------------------------------------------------ role lines

export interface RoleLine {
  title: string;
  personName: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  /** How the person was found; "none" means the line named only a title. */
  via: "separator" | "parentheses" | "marker" | "none";
}

const BOLD = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*/;
const ADVISOR_WORD = /\b(advisor|adviser|advisory)\b/i;
const OPEN_BRACKET = /[[(]\s*(open\s*hire|open\s*role|open|vacant|vacancy|unfilled|tbd|tba|hiring|to be hired|to be filled)\s*[\])]/i;
const ADVISOR_BRACKET = /[[(*]\s*(advisor|adviser|advisory|non-?voting)\s*[\])*]/i;
const SEPARATOR = /\s+[—–]\s+|\s+-\s+|\s+[·•]\s+|:\s+|:$/;

const PARTICLES = new Set(["van", "von", "de", "del", "della", "da", "di", "la", "le", "bin", "al", "st", "mc", "the"]);

/**
 * Whether a fragment reads as a person's name: one to four words, no
 * commas, no digits, no sentence punctuation, and capitalized (or a name
 * particle). "Kristine Min" yes; "topics, order, dates" and "every lead
 * posts done / next / blocked" no.
 */
export function looksLikePerson(raw: string): boolean {
  const text = cleanLine(raw).replace(/\.$/, "");
  if (!text || text.length > 60) return false;
  if (/[,;:/|]/.test(text)) return false;
  if (/\d/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length === 0 || words.length > 4) return false;
  let capitals = 0;
  for (const word of words) {
    const bare = word.replace(/[^\p{L}'’.-]/gu, "");
    if (!bare) return false;
    if (bare[0] === bare[0].toUpperCase() && bare[0] !== bare[0].toLowerCase()) capitals++;
    else if (!PARTICLES.has(foldCase(bare))) return false;
  }
  return capitals >= 1;
}

/**
 * Whether a fragment reads as a position title: short, no sentence
 * punctuation, and not a whole sentence. "Head of Social & Membership" yes;
 * "Sets semester vision, goals, and priorities for the club" no.
 */
export function looksLikeTitle(raw: string): boolean {
  const text = cleanLine(raw);
  if (!text || text.length > 70) return false;
  if (/[.!?]$/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 8) return false;
  if ((text.match(/,/g) ?? []).length > 1) return false;
  return /\p{Lu}/u.test(text) || words.length <= 4;
}

function stripMarkers(raw: string): { text: string; isOpen: boolean; isAdvisor: boolean } {
  let text = raw;
  let isOpen = false;
  let isAdvisor = false;
  for (;;) {
    const open = text.match(OPEN_BRACKET);
    if (!open) break;
    isOpen = true;
    text = `${text.slice(0, open.index)} ${text.slice((open.index ?? 0) + open[0].length)}`;
  }
  for (;;) {
    const advisor = text.match(ADVISOR_BRACKET);
    if (!advisor) break;
    isAdvisor = true;
    text = `${text.slice(0, advisor.index)} ${text.slice((advisor.index ?? 0) + advisor[0].length)}`;
  }
  return { text: cleanLine(text), isOpen, isAdvisor };
}

/**
 * Reads a role line into a title and, when the line names one, a person.
 * Returns null when the line does not read as a role at all.
 *
 * Accepted shapes, in order: "Title: Person", "Title — Person",
 * "Title - Person", "Title (Person)" and a bare "Title" (with or without a
 * marker). A right-hand side that is not a name ("Owns the plan: topics,
 * order, dates") leaves the whole line as the title only when the left side
 * still reads as one, so prose is rejected rather than invented.
 */
export function parseRoleLine(raw: string): RoleLine | null {
  let text = cleanLine(raw).replace(/^#{1,6}\s+/, "").replace(/^[-*•·▪◦]+\s+/, "").replace(/^\d+[.)]\s+/, "");
  const bold = text.match(BOLD);
  const wasBold = Boolean(bold);
  if (bold) text = cleanLine(`${bold[1]} ${text.slice(bold[0].length)}`);
  if (!text) return null;

  const marked = stripMarkers(text);
  text = marked.text;
  if (!text) return null;

  // A labelled line is a field, never a role.
  if (isFieldLine(text)) return null;

  const finish = (title: string, personName: string | null, via: RoleLine["via"]): RoleLine | null => {
    const cleanTitle = cleanLine(title.replace(/[:\-–—·•]+$/, ""));
    if (!cleanTitle || !looksLikeTitle(cleanTitle)) return null;
    const open = marked.isOpen || (personName !== null && isOpenMarker(personName));
    return {
      title: cleanTitle,
      personName: open ? null : personName,
      isOpen: open,
      isAdvisor: marked.isAdvisor || ADVISOR_WORD.test(cleanTitle),
      via,
    };
  };

  const separator = text.match(SEPARATOR);
  if (separator && separator.index !== undefined && separator.index > 0) {
    const left = text.slice(0, separator.index);
    const right = cleanLine(text.slice(separator.index + separator[0].length));
    if (!right) return finish(left, null, "none");
    const rightMarked = stripMarkers(right);
    if (rightMarked.isOpen || isOpenMarker(rightMarked.text)) {
      marked.isOpen = true;
      marked.isAdvisor = marked.isAdvisor || rightMarked.isAdvisor;
      return finish(left, null, "marker");
    }
    if (looksLikePerson(rightMarked.text)) {
      marked.isAdvisor = marked.isAdvisor || rightMarked.isAdvisor;
      return finish(left, cleanLine(rightMarked.text), "separator");
    }
    // The right side is not a name: only a bold or marked line is still a role.
    if (wasBold || marked.isOpen || marked.isAdvisor) return finish(left, null, "none");
    return null;
  }

  // "President (Jackson)" - a trailing parenthesis at the very end only.
  const paren = text.match(/^(.*\S)\s*\(([^()]{1,60})\)$/);
  if (paren && looksLikePerson(paren[2])) {
    return finish(paren[1], cleanLine(paren[2]), "parentheses");
  }

  if (marked.isOpen || marked.isAdvisor || wasBold) return finish(text, null, marked.isOpen ? "marker" : "none");
  return finish(text, null, "none");
}

/**
 * The decisions a responsibility bullet grants, when it is phrased as one
 * ("Final say on budget, Anthropic brand use and board changes"). The
 * bullet itself stays a responsibility; these are added to decides-alone.
 */
const DECIDES_PHRASE = /^(?:has\s+)?(?:the\s+)?(?:final\s+say|sole\s+say|last\s+word|final\s+call|sign-?off|signs?\s+off|decides?\s+alone|decision\s+rights?)\s+(?:on|over|for|about)\s+(.+)$/i;

export function decisionsFromBullet(bullet: string): string[] {
  const match = cleanLine(bullet).match(DECIDES_PHRASE);
  if (!match) return [];
  return splitList(match[1]).map(sentenceCase);
}
