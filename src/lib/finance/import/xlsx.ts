/**
 * Reads the cells of an Excel workbook (.xlsx) as text, in the browser and
 * in Node alike, so a treasurer's spreadsheet imports the way a CSV does.
 *
 * An .xlsx file is a zip of XML parts. Only the parts that hold cell text
 * are inflated (the workbook, its relationships, the shared strings, the
 * styles and the worksheets), so pictures and pivot caches are never
 * decompressed. Each part's declared size is added up before it is
 * inflated and the file is refused once the total passes a cap: fflate
 * inflates into a buffer of exactly the declared size, so a zip bomb
 * can't grow past what it declares.
 *
 * The XML is read with small regular expressions rather than DOMParser,
 * which Node doesn't have, so the same code runs in the unit tests. That
 * holds up because SpreadsheetML is machine-written and shallow, and none
 * of the elements read here nest inside themselves. Some writers put a
 * namespace prefix on every tag (<x:c>), so every pattern allows one.
 *
 * Cells come out as a person would read them: shared and inline strings,
 * TRUE/FALSE, numbers without float noise ("0.30000000000000004" is
 * "0.3"), and date-formatted numbers as YYYY-MM-DD. Excel stores a date as
 * a day count, and only the cell's number format says it is a date.
 */
import { unzipSync, type Unzipped } from "fflate";

export interface SheetData {
  name: string;
  /** Non-empty rows only, each trimmed of trailing empty cells. Cell text as a person would read it. */
  rows: string[][];
  /** 1-based spreadsheet row number of each entry in `rows` (same length). */
  rowNumbers: number[];
  hidden: boolean;
  /** True when rows or columns beyond the limits were dropped. */
  truncated: boolean;
}

/** A workbook that can't be read. Members see the message as is, so it is short and never quotes the file. */
export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

const NOT_A_WORKBOOK = "That file isn't an Excel workbook (.xlsx).";
const TOO_LARGE = "That spreadsheet is too large to open.";
const DAMAGED = "That spreadsheet couldn't be opened. The file may be damaged.";

/** Every zip file starts with a local file header, "PK\x03\x04". */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Every worksheet in the workbook, in tab order. Chart sheets and sheets whose part is missing are left out. */
export function readXlsx(
  bytes: Uint8Array,
  opts: { maxRows?: number; maxCols?: number; maxUncompressedBytes?: number } = {},
): SheetData[] {
  const maxRows = opts.maxRows ?? 20_000;
  const maxCols = opts.maxCols ?? 60;
  const parts = unzipParts(bytes, opts.maxUncompressedBytes ?? 60 * 1024 * 1024);
  const workbookXml = partText(parts, WORKBOOK);
  if (workbookXml === undefined) throw new SpreadsheetError(NOT_A_WORKBOOK);

  const { sheets, date1904 } = readWorkbook(workbookXml);
  const targets = readWorksheetTargets(partText(parts, WORKBOOK_RELS));
  const workbook: Workbook = {
    sharedStrings: readSharedStrings(partText(parts, SHARED_STRINGS)),
    numberKinds: readNumberKinds(partText(parts, STYLES)),
    date1904,
  };

  const result: SheetData[] = [];
  for (const sheet of sheets) {
    const target = targets.get(sheet.relId);
    const xml = target === undefined ? undefined : partText(parts, target);
    if (xml === undefined) continue;
    result.push({
      name: sheet.name,
      ...readRows(xml, workbook, maxRows, maxCols),
      hidden: sheet.hidden,
    });
  }
  return result;
}

// ---- The zip --------------------------------------------------------

// Part names are compared case-insensitively (Office does), so keys are lower case.
const WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS = "xl/sharedstrings.xml";
const STYLES = "xl/styles.xml";
const NEEDED_PARTS = new Set([WORKBOOK, WORKBOOK_RELS, SHARED_STRINGS, STYLES]);
const WORKSHEET_PART = /^xl\/worksheets\/[^/]+\.xml$/;

function unzipParts(bytes: Uint8Array, maxUncompressedBytes: number): Map<string, Uint8Array> {
  if (!isZip(bytes)) throw new SpreadsheetError(NOT_A_WORKBOOK);
  let total = 0;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        const name = file.name.toLowerCase();
        if (!NEEDED_PARTS.has(name) && !WORKSHEET_PART.test(name)) return false;
        total += file.originalSize;
        if (total > maxUncompressedBytes) throw new SpreadsheetError(TOO_LARGE);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new SpreadsheetError(DAMAGED);
  }
  const parts = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) parts.set(name.toLowerCase(), data);
  return parts;
}

/**
 * A part as text. Excel writes UTF-8, but XML also allows UTF-16 with a
 * byte-order mark. Comments are cut out so a commented-out cell isn't read.
 */
function partText(parts: Map<string, Uint8Array>, name: string): string | undefined {
  const bytes = parts.get(name);
  if (!bytes) return undefined;
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const xml = new TextDecoder(encoding).decode(bytes);
  return xml.includes("<!--") ? xml.replace(/<!--[\s\S]*?-->/g, "") : xml;
}

// ---- Workbook-wide parts --------------------------------------------

interface SheetEntry {
  name: string;
  relId: string;
  hidden: boolean;
}

/** The sheets in tab order, and whether day counts start in 1904 (old Mac workbooks) rather than 1900. */
function readWorkbook(xml: string): { sheets: SheetEntry[]; date1904: boolean } {
  const props = firstElement(xml, "workbookPr");
  const date1904 = props
    ? /^(?:1|true)$/i.test(attributes(props.attrs).get("date1904") ?? "")
    : false;
  const sheets: SheetEntry[] = [];
  for (const sheet of eachElement(firstElement(xml, "sheets")?.body ?? "", "sheet")) {
    const attrs = attributes(sheet.attrs);
    const state = attrs.get("state");
    sheets.push({
      name: unescapeOoxml(attrs.get("name") ?? ""),
      relId: attrs.get("id") ?? "",
      hidden: state === "hidden" || state === "veryHidden",
    });
  }
  return { sheets, date1904 };
}

/** Relationship id → worksheet part name. Other relationship types (chart sheets, themes) are skipped. */
function readWorksheetTargets(xml: string | undefined): Map<string, string> {
  const targets = new Map<string, string>();
  for (const rel of eachElement(xml ?? "", "Relationship")) {
    const attrs = attributes(rel.attrs);
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    const type = attrs.get("Type");
    if (!id || !target || attrs.get("TargetMode") === "External") continue;
    if (type && !type.endsWith("/worksheet")) continue;
    targets.set(id, resolvePartName(target));
  }
  return targets;
}

/** A relationship target is relative to xl/ ("worksheets/sheet1.xml") or absolute ("/xl/worksheets/sheet1.xml"). */
function resolvePartName(target: string): string {
  const path = target.startsWith("/") ? target : `xl/${target}`;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/").toLowerCase();
}

function readSharedStrings(xml: string | undefined): string[] {
  return Array.from(eachElement(xml ?? "", "si"), (si) => richText(si.body));
}

// ---- Number formats -------------------------------------------------

type DateKind = "date" | "datetime" | "time" | "duration";
type NumberKind = DateKind | "number";

/** What each cell format shows a number as. A cell's s attribute indexes <cellXfs>. */
function readNumberKinds(xml: string | undefined): NumberKind[] {
  if (!xml) return [];
  // Only <numFmts>: <dxfs> (conditional formatting) has <numFmt>s of its own.
  const custom = new Map<number, NumberKind>();
  for (const numFmt of eachElement(firstElement(xml, "numFmts")?.body ?? "", "numFmt")) {
    const attrs = attributes(numFmt.attrs);
    custom.set(Number(attrs.get("numFmtId")), formatKind(attrs.get("formatCode") ?? ""));
  }
  // Only <cellXfs>: <cellStyleXfs> holds named styles, which cells don't index.
  return Array.from(eachElement(firstElement(xml, "cellXfs")?.body ?? "", "xf"), (xf) => {
    const id = Number(attributes(xf.attrs).get("numFmtId") ?? 0);
    return custom.get(id) ?? builtInKind(id);
  });
}

/**
 * Built-in formats are referenced by id alone. 14–17 are dates, 22 a date
 * with a time, 18–21, 45 and 47 times, 46 is [h]:mm:ss; 27–36 and 50–58
 * are East Asian dates, except 32 and 33, which are times.
 */
function builtInKind(id: number): NumberKind {
  if (id === 22) return "datetime";
  if (id === 46) return "duration";
  if ((id >= 18 && id <= 21) || id === 32 || id === 33 || id === 45 || id === 47) return "time";
  if ((id >= 14 && id <= 17) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return "date";
  return "number";
}

/**
 * Whether a custom format code shows a date, a time, or both. Quoted text,
 * backslash escapes, padding (_x) and fill (*x) characters and bracketed
 * colours, conditions and locales are literal or decoration, so they go
 * first ('0.0 "days"' is a number); an elapsed-time bracket such as [h] is
 * a duration. Then d or y means a date, h or s a time (its m is minutes),
 * and an m on its own is a month.
 */
function formatKind(code: string): NumberKind {
  let elapsed = false;
  const letters = code
    .replace(/"[^"]*"|\\.|[_*].|\[[^\]]*\]/g, (token) => {
      if (/^\[(?:h+|m+|s+)\]$/i.test(token)) elapsed = true;
      return "";
    })
    .toLowerCase();
  const date = /[dy]/.test(letters);
  const time = elapsed || /[hs]/.test(letters);
  if (date) return time ? "datetime" : "date";
  if (time) return elapsed ? "duration" : "time";
  return letters.includes("m") ? "date" : "number";
}

// ---- Worksheets -----------------------------------------------------

interface Workbook {
  sharedStrings: string[];
  numberKinds: NumberKind[];
  date1904: boolean;
}

/**
 * The sheet's non-empty rows, each with its spreadsheet row number. Stops
 * at the first non-empty row past maxRows, so a sheet that is exactly
 * maxRows long isn't reported as truncated.
 */
function readRows(
  xml: string,
  workbook: Workbook,
  maxRows: number,
  maxCols: number,
): Pick<SheetData, "rows" | "rowNumbers" | "truncated"> {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let truncated = false;
  let rowNumber = 0;
  for (const row of eachElement(firstElement(xml, "sheetData")?.body ?? "", "row")) {
    rowNumber = positiveInteger(attributes(row.attrs).get("r")) ?? rowNumber + 1;
    const { cells, dropped } = readCells(row.body, workbook, maxCols);
    if (dropped) truncated = true;
    if (cells.length === 0) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(cells);
    rowNumbers.push(rowNumber);
  }
  return { rows, rowNumbers, truncated };
}

/**
 * One row's cells placed by column, gaps filled with "" and trailing empty
 * cells trimmed (an all-empty row comes back empty). `dropped` says a
 * non-empty cell lay at or past maxCols; formatted but empty cells out
 * there are common and lose nothing.
 */
function readCells(
  xml: string,
  workbook: Workbook,
  maxCols: number,
): { cells: string[]; dropped: boolean } {
  const cells: string[] = [];
  let column = -1;
  let dropped = false;
  for (const cell of eachElement(xml, "c")) {
    const attrs = attributes(cell.attrs);
    column = columnIndex(attrs.get("r")) ?? column + 1;
    if (column >= maxCols) {
      dropped ||= cellText(attrs, cell.body, workbook).trim() !== "";
      continue;
    }
    while (cells.length < column) cells.push("");
    cells[column] = cellText(attrs, cell.body, workbook);
  }
  let end = cells.length;
  while (end > 0 && cells[end - 1].trim() === "") end--;
  cells.length = end;
  return { cells, dropped };
}

/** "A1" → 0, "Z9" → 25, "AA10" → 26; undefined when the reference has no column letters. */
function columnIndex(ref: string | undefined): number | undefined {
  const letters = ref && /^[A-Za-z]+/.exec(ref)?.[0];
  if (!letters) return undefined;
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function positiveInteger(text: string | undefined): number | undefined {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** A cell's text by its type (t). A formula is ignored: its cached result in <v> is the value. */
function cellText(attrs: Map<string, string>, xml: string, workbook: Workbook): string {
  const type = attrs.get("t") ?? "n";
  if (type === "inlineStr") {
    const inline = firstElement(xml, "is");
    if (inline) return richText(inline.body);
  }
  const value = firstElement(xml, "v");
  if (!value) return "";
  const raw = value.body.trim();
  switch (type) {
    case "s":
      return raw === "" ? "" : (workbook.sharedStrings[Number(raw)] ?? "");
    case "b":
      return booleanText(raw);
    case "e":
      return "";
    case "d":
      return isoDateText(raw);
    case "n": {
      const kind = workbook.numberKinds[Number(attrs.get("s") ?? 0)] ?? "number";
      return numberText(raw, kind, workbook.date1904);
    }
    default:
      // "str" (a formula's text result), or a type this reader doesn't know.
      return finishText(decodeText(value.body), preservesSpace(value.attrs));
  }
}

function booleanText(raw: string): string {
  if (/^(?:1|true)$/i.test(raw)) return "TRUE";
  if (/^(?:0|false)$/i.test(raw)) return "FALSE";
  return raw;
}

/** t="d" holds ISO 8601 text: keep the day, and the time of day unless it is midnight. */
function isoDateText(raw: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(raw);
  if (!match) return raw;
  const [, day, time] = match;
  return time && time !== "00:00" ? `${day} ${time}` : day;
}

// ---- Strings --------------------------------------------------------

/**
 * A shared or inline string: one <t>, or rich-text runs whose <t>s join
 * up. Phonetic guides (<rPh>, the furigana over Japanese text) have <t>s
 * of their own that aren't part of the value; <phoneticPr> has no text.
 */
function richText(xml: string): string {
  const visible = xml.includes("rPh") ? withoutElements(xml, "rPh") : xml;
  let text = "";
  let preserve = false;
  for (const t of eachElement(visible, "t")) {
    text += decodeText(t.body);
    preserve ||= preservesSpace(t.attrs);
  }
  return finishText(text, preserve);
}

function preservesSpace(attrs: string): boolean {
  return attrs.includes("preserve") && attributes(attrs).get("space") === "preserve";
}

/**
 * Line breaks become \n. Outer spaces are trimmed unless the file marked
 * them as meant (xml:space="preserve"), which is what Excel does.
 */
function finishText(text: string, preserve: boolean): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  return preserve ? normalized : normalized.trim();
}

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/;

/** XML character data as a string: CDATA sections, entities, then Office's own escapes. */
function decodeText(raw: string): string {
  const text = raw.includes("<![CDATA[")
    ? raw
        .split(CDATA)
        .map((part, i) => (i % 2 === 1 ? part : decodeEntities(part)))
        .join("")
    : decodeEntities(raw);
  return unescapeOoxml(text);
}

const ENTITY = /&(?:#(\d+)|#x([\da-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    ENTITY,
    (
      entity: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
    ) => {
      if (name) return NAMED_ENTITIES[name];
      const code = decimal ? Number(decimal) : Number.parseInt(hex ?? "", 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

const OOXML_ESCAPE = /_x([\da-fA-F]{4})_/g;

/**
 * Office writes characters XML can't carry as _xHHHH_ (_x000D_ is a
 * carriage return), and a literal "_x" that would look like one as _x005F_x.
 * One left-to-right pass undoes both.
 */
function unescapeOoxml(text: string): string {
  if (!text.includes("_x")) return text;
  return text.replace(OOXML_ESCAPE, (_escape: string, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

// ---- Numbers and dates ----------------------------------------------

function numberText(raw: string, kind: NumberKind, date1904: boolean): string {
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value)) return raw;
  return (kind === "number" ? undefined : dateText(value, kind, date1904)) ?? decimalText(value);
}

/**
 * A number as plain decimal text. Rounding to 15 significant digits (all
 * Excel itself shows) and then to at most 10 decimal places removes binary
 * float noise; toFixed keeps tiny numbers out of exponent notation.
 */
function decimalText(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(15));
  const text = String(rounded);
  if (!text.includes("e") && (text.split(".")[1] ?? "").length <= 10) return text;
  const fixed = rounded.toFixed(10).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

const MINUTES_PER_DAY = 1440;
const SECONDS_PER_DAY = 86_400;
const MS_PER_DAY = 86_400_000;
/** 9999-12-31, the last day Excel can show. */
const MAX_SERIAL = 2_958_465;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

/**
 * A day count (Excel's "serial", with the time of day as the fraction) as
 * a date, a time or both; undefined when it is out of range. Times round
 * to the nearest minute, and 23:59:45 rounds into the next day. A date
 * alone rounds to the second first, so float noise such as
 * 44999.99999999999 still lands on day 45000.
 */
function dateText(serial: number, kind: DateKind, date1904: boolean): string | undefined {
  if (serial < 0 || serial > MAX_SERIAL) return undefined;
  if (kind === "date") {
    return calendarDay(
      Math.floor(Math.round(serial * SECONDS_PER_DAY) / SECONDS_PER_DAY),
      date1904,
    );
  }
  const totalMinutes = Math.round(serial * MINUTES_PER_DAY);
  if (kind === "duration") return clock(totalMinutes);
  const minutes = totalMinutes % MINUTES_PER_DAY;
  if (kind === "time") return clock(minutes);
  const day = calendarDay((totalMinutes - minutes) / MINUTES_PER_DAY, date1904);
  return day && minutes > 0 ? `${day} ${clock(minutes)}` : day;
}

/**
 * Day N of the workbook's date system as YYYY-MM-DD. The 1900 system
 * counts a 29 February 1900 that never happened (kept from Lotus 1-2-3), so
 * counting from 1899-12-30 is right from day 61 on, puts that phantom day
 * 60 on the 28th, and puts every earlier day one day too early.
 */
function calendarDay(days: number, date1904: boolean): string | undefined {
  if (date1904) return isoDay(EPOCH_1904 + days * MS_PER_DAY);
  return isoDay(EPOCH_1900 + (days < 60 ? days + 1 : days) * MS_PER_DAY);
}

function isoDay(ms: number): string | undefined {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (year > 9999) return undefined;
  return `${year}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** HH:MM, where a duration's hours may pass 24. */
function clock(totalMinutes: number): string {
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ---- XML ------------------------------------------------------------

/** A namespace prefix, which some writers put on every tag (<x:c>). */
const PREFIX = "(?:[\\w.-]+:)?";
/** A start tag's attributes, quote-aware so that a ">" inside a value doesn't end the tag. */
const ATTRS = `((?:[^<>"']|"[^<"]*"|'[^<']*')*)`;

interface XmlElement {
  attrs: string;
  body: string;
  start: number;
  end: number;
}

/**
 * One start-tag pattern per element name, built once: a worksheet asks for
 * the same few names hundreds of thousands of times. Every use sets
 * lastIndex right before exec, so sharing a pattern is safe.
 */
const startTags = new Map<string, RegExp>();

function startTag(name: string): RegExp {
  let pattern = startTags.get(name);
  if (!pattern) {
    pattern = new RegExp(`<(${PREFIX})${name}(?=[\\s/>])${ATTRS}>`, "g");
    startTags.set(name, pattern);
  }
  return pattern;
}

/**
 * The first <name …>…</name> or <name …/> at or after `from`, with or
 * without a prefix. The first matching end tag closes it, which is right
 * because the elements read here never nest inside themselves.
 */
function firstElement(xml: string, name: string, from = 0): XmlElement | undefined {
  const pattern = startTag(name);
  pattern.lastIndex = from;
  const match = pattern.exec(xml);
  if (!match) return undefined;
  const [tag, prefix, attrs] = match;
  const afterTag = match.index + tag.length;
  if (attrs.endsWith("/"))
    return { attrs: attrs.slice(0, -1), body: "", start: match.index, end: afterTag };
  const close = findEndTag(xml, prefix + name, afterTag);
  return (
    close && { attrs, body: xml.slice(afterTag, close.start), start: match.index, end: close.end }
  );
}

/** Each <name> element in `xml`, in document order. An element with no end tag ends the list. */
function* eachElement(xml: string, name: string): Generator<XmlElement, void> {
  for (
    let element = firstElement(xml, name);
    element;
    element = firstElement(xml, name, element.end)
  ) {
    yield element;
  }
}

/** `</qname>` at or after `from` (XML allows spaces before the ">"). */
function findEndTag(
  xml: string,
  qname: string,
  from: number,
): { start: number; end: number } | undefined {
  const needle = `</${qname}`;
  for (let at = xml.indexOf(needle, from); at >= 0; at = xml.indexOf(needle, at + 1)) {
    let end = at + needle.length;
    while (end < xml.length && " \t\r\n".includes(xml[end])) end++;
    if (xml[end] === ">") return { start: at, end: end + 1 };
  }
  return undefined;
}

/** `xml` with every <name> element cut out. */
function withoutElements(xml: string, name: string): string {
  let kept = "";
  let from = 0;
  for (const element of eachElement(xml, name)) {
    kept += xml.slice(from, element.start);
    from = element.end;
  }
  return kept + xml.slice(from);
}

const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * A start tag's attributes by local name (r:id is "id"), values decoded.
 * Namespace declarations are skipped: xmlns:r would otherwise read as "r".
 */
function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  for (let match = ATTRIBUTE.exec(source); match; match = ATTRIBUTE.exec(source)) {
    const [, qname, doubleQuoted, singleQuoted] = match;
    if (qname === "xmlns" || qname.startsWith("xmlns:")) continue;
    result.set(qname.slice(qname.indexOf(":") + 1), decodeEntities(doubleQuoted ?? singleQuoted));
  }
  return result;
}
