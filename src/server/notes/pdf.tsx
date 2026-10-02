import "server-only";

import type { ReactNode } from "react";
import { TZDate } from "@date-fns/tz";
import {
  Document,
  Link,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
  type Styles,
} from "@react-pdf/renderer";
import { format } from "date-fns";

/**
 * A note as a PDF: the ProseMirror document the TipTap editor saves
 * (src/components/notes/editor/note-editor.tsx) mapped onto react-pdf
 * primitives, under a header with the title, author, linked event and last
 * edit. Covers every node and mark the editor can produce (StarterKit, task
 * lists, tables); anything else falls back to its plain text, so content is
 * never silently dropped.
 *
 * The page uses the PDF standard fonts (Helvetica, Courier), so nothing is
 * fetched or bundled. They cover Latin-1 and common punctuation (accents,
 * smart quotes, dashes, the euro sign). Common symbols outside it (arrows,
 * check marks) are spelled out, e.g. "->"; anything else (emoji, CJK) has no
 * glyph and becomes "?" rather than garbage.
 */

export interface NotePdfInput {
  title: string;
  contentJson: unknown;
  authorName: string;
  orgName: string;
  timezone: string;
  updatedAt: Date;
  visibility: "PRIVATE" | "ORGANIZATION";
  event: { title: string; startsAt: Date } | null;
}

type Style = Styles[string];

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface PMNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

/** Nesting deeper than this renders as plain text: real notes never get close. */
const MAX_DEPTH = 16;

const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

const COLOR = {
  text: "#171717",
  muted: "#737373",
  subtle: "#a3a3a3",
  border: "#e5e5e5",
  surface: "#f5f5f5",
  link: "#2563eb",
};

/** US Letter, in points. */
const PAGE_HEIGHT = 792;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 1.5;
const LINE = BODY_SIZE * LINE_HEIGHT;

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 60,
    paddingHorizontal: 60,
    fontFamily: "Helvetica",
    fontSize: BODY_SIZE,
    lineHeight: LINE_HEIGHT,
    color: COLOR.text,
  },
  header: {
    marginBottom: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.border,
  },
  org: { fontSize: 8.5, color: COLOR.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontSize: 22, fontWeight: "bold", lineHeight: 1.25, marginTop: 4, marginBottom: 6 },
  meta: { fontSize: 9, color: COLOR.muted },
  empty: { color: COLOR.subtle, fontStyle: "italic" },
  paragraph: { marginBottom: 7 },
  tight: { marginBottom: 2 },
  h1: { fontSize: 18, fontWeight: "bold", lineHeight: 1.3, marginTop: 12, marginBottom: 6 },
  h2: { fontSize: 15, fontWeight: "bold", lineHeight: 1.3, marginTop: 10, marginBottom: 5 },
  h3: { fontSize: 12.5, fontWeight: "bold", lineHeight: 1.3, marginTop: 8, marginBottom: 4 },
  list: { marginBottom: 7 },
  nestedList: { marginTop: 2 },
  listItem: { flexDirection: "row", marginBottom: 2 },
  marker: { width: 18, flexShrink: 0 },
  number: { width: 18, flexShrink: 0, textAlign: "right", paddingRight: 5 },
  listBody: { flex: 1 },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.border,
    paddingLeft: 10,
    marginBottom: 7,
    color: "#525252",
    fontStyle: "italic",
  },
  codeBlock: {
    backgroundColor: COLOR.surface,
    borderRadius: 4,
    padding: 8,
    marginBottom: 7,
    fontFamily: "Courier",
    fontSize: 9,
    lineHeight: 1.4,
  },
  rule: { borderBottomWidth: 1, borderBottomColor: COLOR.border, marginVertical: 10 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: COLOR.border, marginBottom: 9 },
  row: { flexDirection: "row" },
  cell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLOR.border,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  headerCell: { backgroundColor: "#fafafa", fontWeight: "bold" },
  // Anchored by `top`, not `bottom`: react-pdf 4 lays a fixed element with a
  // render prop (the page number) out thousands of points off the page when
  // it is positioned from the bottom edge.
  footer: {
    position: "absolute",
    top: PAGE_HEIGHT - 40,
    left: 60,
    right: 60,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COLOR.subtle,
  },
  footerTitle: { maxWidth: "75%" },
});

/** Bullets as shapes, not glyphs: filled dot, hollow dot, square by depth. */
function Bullet({ depth }: { depth: number }) {
  const kind = depth % 3;
  const size = kind === 2 ? 3.5 : 4;
  return (
    <View style={styles.marker}>
      <View
        style={{
          width: size,
          height: size,
          marginTop: (LINE - size) / 2,
          marginLeft: 5,
          borderRadius: kind === 2 ? 0 : size / 2,
          ...(kind === 1
            ? { borderWidth: 0.8, borderColor: COLOR.text }
            : { backgroundColor: COLOR.text }),
        }}
      />
    </View>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  const size = 9;
  return (
    <View style={styles.marker}>
      <View
        style={{
          width: size,
          height: size,
          marginTop: (LINE - size) / 2,
          borderWidth: 0.8,
          borderRadius: 2,
          borderColor: checked ? COLOR.text : COLOR.muted,
          backgroundColor: checked ? COLOR.text : undefined,
        }}
      >
        {checked && (
          <Svg width={size - 1.6} height={size - 1.6} viewBox="0 0 10 10">
            <Path d="M2 5.2 L4.2 7.4 L8 2.8" stroke="#ffffff" strokeWidth={1.6} fill="none" />
          </Svg>
        )}
      </View>
    </View>
  );
}

function children(node: PMNode): PMNode[] {
  return Array.isArray(node.content) ? node.content : [];
}

function colspan(cell: PMNode): number {
  return Math.max(1, Math.floor(Number(cell.attrs?.colspan)) || 1);
}

/**
 * Code keeps its indentation: react-pdf collapses leading and repeated
 * spaces, so turn those into no-break spaces (same width in Courier), and
 * tabs into two spaces.
 */
function preserveSpaces(code: string): string {
  return code
    .replace(/\t/g, "  ")
    .replace(/^ +/gm, (run) => NBSP.repeat(run.length))
    .replace(/ {2,}/g, (run) => NBSP.repeat(run.length - 1) + " ");
}

/** All text under `node`, walked iteratively so a pathological document can't blow the stack. */
export function plainText(node: PMNode): string {
  const out: string[] = [];
  const stack: PMNode[] = [node];
  while (stack.length) {
    const next = stack.pop()!;
    if (typeof next.text === "string") out.push(next.text);
    if (next.type === "hardBreak") out.push("\n");
    const kids = children(next);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out.join("");
}

/**
 * Everything WinAnsi (the standard fonts' encoding) can draw: printable
 * ASCII, Latin-1, and the Windows-1252 extras in 0x80-0x9F (curly quotes,
 * dashes, bullet, ellipsis, euro, trademark, ...).
 */
const NBSP = "\u00a0";

const NOT_WIN_ANSI =
  /[^\n\t\x20-\x7e\xa0-\xff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]+/gu;

/** Common note symbols outside WinAnsi, spelled with characters it has. */
const FALLBACKS: Record<string, string> = {
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u21d2": "=>",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2260": "!=",
  "\u2248": "~",
  "\u2212": "-",
  "\u2610": "[ ]",
  "\u2611": "[x]",
  "\u2713": "[x]",
  "\u2714": "[x]",
  "\u2705": "[x]",
};

/**
 * Text the standard fonts can draw: the fallbacks above, then each run of
 * anything else (emoji with their modifiers and joiners, CJK, ...) as one "?".
 */
export function toWinAnsi(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(
      /[\u2190\u2192\u2194\u21d2\u2212\u2248\u2260\u2264\u2265\u2610\u2611\u2705\u2713\u2714]\ufe0f?/gu,
      (c) => FALLBACKS[c[0]!]!,
    )
    .replace(NOT_WIN_ANSI, "?");
}

function markStyle(marks: PMMark[]): { style: Style; href: string | null } {
  const style: Style = {};
  const decorations: string[] = [];
  let href: string | null = null;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        style.fontWeight = "bold";
        break;
      case "italic":
        style.fontStyle = "italic";
        break;
      case "underline":
        decorations.push("underline");
        break;
      case "strike":
        decorations.push("line-through");
        break;
      case "code":
        style.fontFamily = "Courier";
        style.fontSize = BODY_SIZE * 0.92;
        style.backgroundColor = COLOR.surface;
        break;
      case "link": {
        const raw = typeof mark.attrs?.href === "string" ? mark.attrs.href.trim() : "";
        if (SAFE_LINK.test(raw)) {
          href = raw;
          style.color = COLOR.link;
          if (!decorations.includes("underline")) decorations.push("underline");
        }
        break;
      }
    }
  }
  if (decorations.length) style.textDecoration = decorations.join(" ") as Style["textDecoration"];
  return { style, href };
}

function Inline({ nodes }: { nodes: PMNode[] }) {
  return nodes.map((node, i) => {
    if (node.type === "hardBreak") return "\n";
    if (typeof node.text !== "string") return toWinAnsi(plainText(node));
    const { style, href } = markStyle(Array.isArray(node.marks) ? node.marks : []);
    const text = toWinAnsi(node.text);
    return href ? (
      <Link key={i} src={href} style={style}>
        {text}
      </Link>
    ) : (
      <Text key={i} style={style}>
        {text}
      </Text>
    );
  });
}

interface BlockOptions {
  depth: number;
  /** Inside a list item or table cell: paragraphs sit closer together. */
  tight?: boolean;
}

function Blocks({ nodes, depth, tight }: { nodes: PMNode[] } & BlockOptions): ReactNode {
  return nodes.map((node, i) => <Block key={i} node={node} depth={depth} tight={tight} />);
}

function Block({ node, depth, tight }: { node: PMNode } & BlockOptions): ReactNode {
  if (depth > MAX_DEPTH) {
    return <Text style={styles.paragraph}>{toWinAnsi(plainText(node))}</Text>;
  }
  const kids = children(node);

  switch (node.type) {
    case "paragraph":
      return (
        <Text style={tight ? styles.tight : styles.paragraph}>
          {kids.length ? <Inline nodes={kids} /> : " "}
        </Text>
      );

    case "heading": {
      const level = Number(node.attrs?.level);
      const style = level <= 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3;
      return (
        <Text style={style} minPresenceAhead={LINE * 2}>
          <Inline nodes={kids} />
        </Text>
      );
    }

    case "bulletList":
    case "orderedList":
    case "taskList": {
      const start = Number(node.attrs?.start) || 1;
      return (
        <View style={depth > 0 && tight ? styles.nestedList : styles.list}>
          {kids.map((item, i) => (
            <View key={i} style={styles.listItem}>
              {node.type === "orderedList" ? (
                <Text style={styles.number}>{start + i}.</Text>
              ) : node.type === "taskList" ? (
                <Checkbox checked={item.attrs?.checked === true} />
              ) : (
                <Bullet depth={depth} />
              )}
              <View style={styles.listBody}>
                <Blocks nodes={children(item)} depth={depth + 1} tight />
              </View>
            </View>
          ))}
        </View>
      );
    }

    case "blockquote":
      return (
        <View style={styles.blockquote}>
          <Blocks nodes={kids} depth={depth + 1} tight />
        </View>
      );

    case "codeBlock":
      return (
        <View style={styles.codeBlock}>
          <Text>{preserveSpaces(toWinAnsi(plainText(node)))}</Text>
        </View>
      );

    case "horizontalRule":
      return <View style={styles.rule} />;

    case "table": {
      // Percentage widths from each cell's colspan, so a merged cell lines
      // up with the columns it spans.
      const columns = Math.max(
        1,
        ...kids.map((row) => children(row).reduce((n, cell) => n + colspan(cell), 0)),
      );
      return (
        <View style={styles.table}>
          {kids.map((row, r) => (
            <View key={r} style={styles.row} wrap={false}>
              {children(row).map((cell, c) => (
                <View
                  key={c}
                  style={[
                    styles.cell,
                    { width: `${(colspan(cell) / columns) * 100}%` },
                    cell.type === "tableHeader" ? styles.headerCell : {},
                  ]}
                >
                  <Blocks nodes={children(cell)} depth={depth + 1} tight />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }

    default: {
      const text = plainText(node);
      return text ? <Text style={styles.paragraph}>{toWinAnsi(text)}</Text> : null;
    }
  }
}

function formatDate(date: Date, timezone: string, pattern: string) {
  return format(new TZDate(date.getTime(), timezone || "UTC"), pattern);
}

function NoteDocument({ note }: { note: NotePdfInput }) {
  const doc = (note.contentJson ?? {}) as PMNode;
  const blocks = children(doc);
  const isEmpty = !plainText(doc).trim() && !blocks.some((b) => b.type === "table");
  const title = note.title.trim() || "Untitled note";

  const meta = [
    `By ${note.authorName}`,
    `Updated ${formatDate(note.updatedAt, note.timezone, "MMM d, yyyy 'at' h:mm a")}`,
    note.visibility === "PRIVATE" ? "Private" : "Shared with the org",
  ];

  return (
    <Document
      title={title}
      author={note.authorName}
      subject={`Note from ${note.orgName}`}
      creator="CBC Portal"
      producer="CBC Portal"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.org}>{toWinAnsi(note.orgName)}</Text>
          <Text style={styles.title}>{toWinAnsi(title)}</Text>
          <Text style={styles.meta}>{toWinAnsi(meta.join("  ·  "))}</Text>
          {note.event && (
            <Text style={styles.meta}>
              {toWinAnsi(
                `Event: ${note.event.title} (${formatDate(note.event.startsAt, note.timezone, "MMM d, yyyy")})`,
              )}
            </Text>
          )}
        </View>

        {isEmpty ? (
          <Text style={styles.empty}>This note is empty.</Text>
        ) : (
          <Blocks nodes={blocks} depth={0} />
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerTitle}>{toWinAnsi(title)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderNotePdf(note: NotePdfInput): Promise<Buffer> {
  return renderToBuffer(<NoteDocument note={note} />);
}

/** "Q3 planning / budget" -> "Q3 planning - budget.pdf": path separators can't survive a download. */
export function notePdfFilename(title: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "Untitled note";
  return `${base.slice(0, 120)}.pdf`;
}
