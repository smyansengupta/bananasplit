import type { JSONContent } from "@tiptap/core";
import type { Definition, List, ListItem, Nodes, PhrasingContent, RootContent, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * Markdown as a note body (the AI connectors' create_note): GitHub-flavoured
 * Markdown parsed by micromark, written as the ProseMirror JSON the note
 * editor saves. The reverse of src/lib/notes/export/markdown.ts: a note
 * written in the blocks below comes back from its Download Markdown as the
 * same document.
 *
 * - Paragraphs, headings, quotes, rules, code blocks, tables, and bullet,
 *   numbered and checklists; bold, italic, strikethrough, <u>underline</u>,
 *   inline code, links and line breaks.
 * - Links keep only web, mail and phone addresses and paths in the app;
 *   any other link keeps its text.
 * - An image becomes a link to it: a note's images are the club's own
 *   uploads, and a picture from elsewhere would be fetched by every member
 *   who opens the note.
 * - Raw HTML stays as the text it is; nothing from it is rendered.
 *
 * Callouts, toggles, columns, mentions and the other note blocks have no
 * Markdown of their own, so the export's stand-ins for them (a quote, a
 * bold line) come back as those plain blocks. Check the result against
 * the note schema (checkNoteContent) before storing it.
 */

type Mark = NonNullable<JSONContent["marks"]>[number];

const SAFE_LINK = /^(https?:|mailto:|tel:|\/(?![/\\]))/i;

interface Scope {
  /** Link reference definitions, by identifier ([text][id] … [id]: url). */
  definitions: Map<string, string>;
}

function safeHref(url: string | null | undefined): string | null {
  const href = (url ?? "").trim();
  return href && SAFE_LINK.test(href) ? href : null;
}

/** A node's text: what it reads as with its formatting dropped. */
function textOf(node: Nodes): string {
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (node.type === "break") return " ";
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(textOf).join("");
  return "";
}

function text(value: string, marks: Mark[]): JSONContent[] {
  // A soft line break inside a paragraph reads as a space.
  const clean = value.replace(/\r?\n/g, " ");
  if (!clean) return [];
  return [{ type: "text", text: clean, ...(marks.length > 0 ? { marks } : {}) }];
}

function withMark(marks: Mark[], mark: Mark): Mark[] {
  return marks.some((m) => m.type === mark.type) ? marks : [...marks, mark];
}

function inline(nodes: PhrasingContent[], scope: Scope, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  // The export writes underline as <u>…</u>, which arrives as two HTML nodes.
  let underline = false;
  for (const node of nodes) {
    const m = underline ? withMark(marks, { type: "underline" }) : marks;
    switch (node.type) {
      case "text":
        out.push(...text(node.value, m));
        break;
      case "strong":
        out.push(...inline(node.children, scope, withMark(m, { type: "bold" })));
        break;
      case "emphasis":
        out.push(...inline(node.children, scope, withMark(m, { type: "italic" })));
        break;
      case "delete":
        out.push(...inline(node.children, scope, withMark(m, { type: "strike" })));
        break;
      case "inlineCode":
        // Code excludes every other mark in the note schema.
        out.push(...text(node.value, [{ type: "code" }]));
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "link":
      case "linkReference": {
        const href = safeHref(
          node.type === "link" ? node.url : scope.definitions.get(node.identifier.toLowerCase()),
        );
        out.push(
          ...inline(
            node.children,
            scope,
            href ? withMark(m, { type: "link", attrs: { href } }) : m,
          ),
        );
        break;
      }
      case "image":
      case "imageReference": {
        const src =
          node.type === "image" ? node.url : scope.definitions.get(node.identifier.toLowerCase());
        const href = safeHref(src);
        const label = node.alt?.trim() || href || "Image";
        out.push(...text(label, href ? withMark(m, { type: "link", attrs: { href } }) : m));
        break;
      }
      case "html": {
        const tag = node.value.trim().toLowerCase();
        if (tag === "<u>") underline = true;
        else if (tag === "</u>") underline = false;
        else if (/^<br\s*\/?>$/.test(tag)) out.push({ type: "hardBreak" });
        else out.push(...text(node.value, m));
        break;
      }
      case "footnoteReference":
        out.push(...text(`[^${node.label ?? node.identifier}]`, m));
        break;
      default:
        out.push(...text(textOf(node), m));
    }
  }
  return out;
}

function paragraph(content: JSONContent[]): JSONContent {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function blocks(nodes: RootContent[], scope: Scope): JSONContent[] {
  return nodes.flatMap((node) => block(node, scope));
}

/** Content that must hold at least one block (a quote, a cell, the document). */
function someBlocks(nodes: RootContent[], scope: Scope): JSONContent[] {
  const out = blocks(nodes, scope);
  return out.length > 0 ? out : [paragraph([])];
}

/** A list item's content: a paragraph first, as the schema has it, then any blocks. */
function itemContent(item: ListItem, scope: Scope): JSONContent[] {
  const out = blocks(item.children, scope);
  return out[0]?.type === "paragraph" ? out : [paragraph([]), ...out];
}

function list(node: List, scope: Scope): JSONContent {
  const checklist = node.children.some((item) => typeof item.checked === "boolean");
  const items = node.children.map((item) =>
    checklist
      ? {
          type: "taskItem",
          attrs: { checked: item.checked === true },
          content: itemContent(item, scope),
        }
      : { type: "listItem", content: itemContent(item, scope) },
  );
  if (checklist) return { type: "taskList", content: items };
  return node.ordered
    ? { type: "orderedList", attrs: { start: node.start ?? 1 }, content: items }
    : { type: "bulletList", content: items };
}

function table(node: Table, scope: Scope): JSONContent {
  const width = Math.max(1, ...node.children.map((row) => row.children.length));
  return {
    type: "table",
    content: node.children.map((row, r) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, c) => ({
        type: r === 0 ? "tableHeader" : "tableCell",
        content: [paragraph(inline(row.children[c]?.children ?? [], scope))],
      })),
    })),
  };
}

function block(node: RootContent, scope: Scope): JSONContent[] {
  switch (node.type) {
    case "paragraph":
      return [paragraph(inline(node.children, scope))];
    case "heading": {
      const content = inline(node.children, scope);
      return [
        {
          type: "heading",
          attrs: { level: node.depth },
          ...(content.length > 0 ? { content } : {}),
        },
      ];
    }
    case "thematicBreak":
      return [{ type: "horizontalRule" }];
    case "blockquote":
      return [{ type: "blockquote", content: someBlocks(node.children, scope) }];
    case "list":
      return [list(node, scope)];
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: node.lang || null },
          ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
        },
      ];
    case "table":
      return [table(node, scope)];
    case "html":
      return node.value.trim() ? [paragraph(text(node.value, []))] : [];
    case "definition":
      return [];
    case "footnoteDefinition":
      return blocks(node.children, scope);
    default: {
      const value = textOf(node);
      return value.trim() ? [paragraph(text(value, []))] : [];
    }
  }
}

function definitionsOf(nodes: Nodes[], into = new Map<string, string>()): Map<string, string> {
  for (const node of nodes) {
    if (node.type === "definition") {
      const def = node as Definition;
      if (!into.has(def.identifier.toLowerCase())) into.set(def.identifier.toLowerCase(), def.url);
    } else if ("children" in node) {
      definitionsOf(node.children as Nodes[], into);
    }
  }
  return into;
}

export interface MarkdownNote {
  /** The title: the one given, else a leading "# heading", else "". */
  title: string;
  /** The body as note JSON (a doc), to check with checkNoteContent. */
  content: JSONContent;
}

/**
 * Markdown as a note. A leading "# heading" is the title when none is
 * given, and is dropped when it repeats the title, as Download Markdown
 * writes the title that way.
 */
export function markdownToNote(markdown: string, title?: string): MarkdownNote {
  const root = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const scope: Scope = { definitions: definitionsOf(root.children) };
  let children = root.children;
  let heading = "";
  const first = children[0];
  if (first?.type === "heading" && first.depth === 1) {
    const leading = textOf(first).trim();
    if (title === undefined || leading === title.trim()) {
      heading = leading;
      children = children.slice(1);
    }
  }
  return {
    title: title?.trim() ?? heading,
    content: { type: "doc", content: someBlocks(children, scope) },
  };
}
