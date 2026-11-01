import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";

import { paperOf } from "@/lib/notes/paper";
import { plain, type MdNode } from "@/lib/notes/export/markdown";

/**
 * A note as a Word document (the note page's "…" › Download Word): the
 * ProseMirror JSON mapped onto docx paragraphs, on the note's paper (Letter
 * or A4, one-inch margins), with the title and club in the header and page
 * numbers in the footer, like the PDF. Pending suggestions show as Word
 * would: insertions underlined, deletions struck through. Images and files
 * are links to the club's file (their bytes stay in storage).
 */

export interface NoteDocxInput {
  title: string;
  contentJson: unknown;
  orgName: string;
  paperSize: string | null;
  /** The club's base URL, for page links and files. */
  baseUrl: string;
  orgId: string;
}

/** Twips: 1/1440 inch. */
const TWIPS_PER_IN = 1440;
const MAX_DEPTH = 12;

function kids(node: MdNode): MdNode[] {
  return Array.isArray(node.content) ? node.content : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

interface Ctx {
  input: NoteDocxInput;
}

function runOptions(node: MdNode): IRunOptions {
  const marks = node.marks ?? [];
  const has = (t: string) => marks.some((m) => m.type === t);
  return {
    text: str(node.text),
    bold: has("bold") || undefined,
    italics: has("italic") || undefined,
    strike: has("strike") || has("suggestionDelete") || undefined,
    underline: has("underline") || has("suggestionInsert") ? {} : undefined,
    font: has("code") ? "Courier New" : undefined,
  };
}

function runs(nodes: MdNode[], ctx: Ctx): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const href = str(node.marks?.find((m) => m.type === "link")?.attrs?.href).trim();
      const run = new TextRun(runOptions(node));
      out.push(
        /^(https?:|mailto:)/i.test(href)
          ? new ExternalHyperlink({
              link: href,
              children: [new TextRun({ ...runOptions(node), style: "Hyperlink" })],
            })
          : run,
      );
    } else if (node.type === "hardBreak") {
      out.push(new TextRun({ text: "", break: 1 }));
    } else if (node.type === "noteLink") {
      out.push(
        new ExternalHyperlink({
          link: `${ctx.input.baseUrl}/notes/${str(node.attrs?.noteId)}`,
          children: [
            new TextRun({ text: str(node.attrs?.title) || "Untitled", style: "Hyperlink" }),
          ],
        }),
      );
    } else if (node.type === "mention") {
      out.push(new TextRun({ text: `@${str(node.attrs?.label) || "someone"}`, bold: true }));
    } else {
      const text = plain(node);
      if (text) out.push(new TextRun(text));
    }
  }
  return out;
}

type Block = Paragraph | Table;

function blocks(nodes: MdNode[], ctx: Ctx, depth: number, list?: ListCtx): Block[] {
  return nodes.flatMap((n) => block(n, ctx, depth, list));
}

interface ListCtx {
  kind: "bullet" | "ordered" | "task";
  level: number;
  instance: number;
  checked?: boolean;
}

let listInstance = 0;

function paragraphFor(children: ParagraphChild[], list?: ListCtx, extra = {}): Paragraph {
  if (!list) return new Paragraph({ children, spacing: { after: 120 }, ...extra });
  if (list.kind === "ordered") {
    return new Paragraph({
      children,
      numbering: { reference: "note-ordered", level: list.level, instance: list.instance },
      ...extra,
    });
  }
  if (list.kind === "task") {
    return new Paragraph({
      children: [new TextRun(list.checked ? "☑ " : "☐ "), ...children],
      indent: { left: 360 * (list.level + 1) },
      ...extra,
    });
  }
  return new Paragraph({ children, bullet: { level: Math.min(list.level, 8) }, ...extra });
}

function block(node: MdNode, ctx: Ctx, depth: number, list?: ListCtx): Block[] {
  if (depth > MAX_DEPTH) return [new Paragraph(plain(node))];
  switch (node.type) {
    case "paragraph":
      return [paragraphFor(runs(kids(node), ctx), list)];
    case "heading": {
      const level = Number(node.attrs?.level) || 1;
      return [
        new Paragraph({
          children: runs(kids(node), ctx),
          heading:
            level <= 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
        }),
      ];
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const kind =
        node.type === "orderedList" ? "ordered" : node.type === "taskList" ? "task" : "bullet";
      const level = list ? list.level + 1 : 0;
      const instance = kind === "ordered" ? ++listInstance : 0;
      return kids(node).flatMap((item) =>
        kids(item).flatMap((child, i) =>
          child.type === "paragraph" && i === 0
            ? [
                paragraphFor(runs(kids(child), ctx), {
                  kind,
                  level,
                  instance,
                  checked: item.attrs?.checked === true,
                }),
              ]
            : block(child, ctx, depth + 1, { kind, level, instance }),
        ),
      );
    }
    case "blockquote":
    case "callout": {
      const lead = node.type === "callout" ? `${str(node.attrs?.emoji) || "💡"} ` : "";
      return kids(node).map(
        (child, i) =>
          new Paragraph({
            children: [...(i === 0 && lead ? [new TextRun(lead)] : []), ...runs(kids(child), ctx)],
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 8 } },
            shading:
              node.type === "callout"
                ? { type: ShadingType.CLEAR, color: "auto", fill: "EEF3FA" }
                : undefined,
            spacing: { after: 80 },
          }),
      );
    }
    case "codeBlock":
      return plain(node)
        .split("\n")
        .map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Courier New", size: 18 })],
              shading: { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" },
            }),
        );
    case "horizontalRule":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD", space: 1 } },
        }),
      ];
    case "pageBreak":
      return [new Paragraph({ children: [new PageBreak()] })];
    case "table": {
      const rows = kids(node);
      const columns = Math.max(1, ...rows.map((r) => kids(r).length));
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (row) =>
              new TableRow({
                children: kids(row).map(
                  (cell) =>
                    new TableCell({
                      columnSpan: Number(cell.attrs?.colspan) || undefined,
                      width: { size: 100 / columns, type: WidthType.PERCENTAGE },
                      shading:
                        cell.type === "tableHeader"
                          ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" }
                          : undefined,
                      children: (() => {
                        const inner = blocks(kids(cell), ctx, depth + 1).filter(
                          (b): b is Paragraph => b instanceof Paragraph,
                        );
                        return inner.length ? inner : [new Paragraph("")];
                      })(),
                    }),
                ),
              }),
          ),
        }),
      ];
    }
    case "details": {
      const [summary, content] = kids(node);
      return [
        new Paragraph({
          children: summary ? runs(kids(summary), ctx).map((r) => r) : [],
          spacing: { after: 80 },
          style: "Strong",
        }),
        ...(content ? blocks(kids(content), ctx, depth + 1) : []),
      ];
    }
    case "columns":
      return kids(node).flatMap((col) => blocks(kids(col), ctx, depth + 1));
    case "image":
    case "fileAttachment": {
      const fileId = str(node.attrs?.fileId);
      const name =
        node.type === "image" ? str(node.attrs?.alt) || "Image" : str(node.attrs?.name) || "File";
      if (!fileId) return [new Paragraph(name)];
      return [
        new Paragraph({
          children: [
            new ExternalHyperlink({
              link: `${ctx.input.baseUrl.replace(/\/app\/[^/]+$/, "")}/api/orgs/${ctx.input.orgId}/files/${fileId}`,
              children: [
                new TextRun({
                  text: node.type === "image" ? `[Image: ${name}]` : name,
                  style: "Hyperlink",
                }),
              ],
            }),
          ],
        }),
      ];
    }
    case "taskChip":
      return [
        paragraphFor([new TextRun(str(node.attrs?.title) || "Task")], {
          kind: "task",
          level: 0,
          instance: 0,
        }),
      ];
    case "linkCard":
      return [
        new Paragraph({
          children: [
            new ExternalHyperlink({
              link: `${ctx.input.baseUrl}/${str(node.attrs?.path)}`,
              children: [
                new TextRun({ text: str(node.attrs?.title) || "Open", style: "Hyperlink" }),
              ],
            }),
          ],
        }),
      ];
    default: {
      const text = plain(node);
      return text ? [new Paragraph(text)] : [];
    }
  }
}

/** The note as a .docx file. */
export async function renderNoteDocx(input: NoteDocxInput): Promise<Buffer> {
  const paper = paperOf(input.paperSize);
  const title = input.title.trim() || "Untitled note";
  const doc = (input.contentJson ?? {}) as MdNode;
  const ctx: Ctx = { input };
  const body = blocks(kids(doc), ctx, 0);
  const document = new Document({
    creator: "Bananasplit",
    title,
    description: `Note from ${input.orgName}`,
    numbering: {
      config: [
        {
          reference: "note-ordered",
          levels: [0, 1, 2, 3, 4, 5].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: Math.round(paper.widthIn * TWIPS_PER_IN),
              height: Math.round(paper.heightIn * TWIPS_PER_IN),
            },
            margin: {
              top: TWIPS_PER_IN,
              bottom: TWIPS_PER_IN,
              left: TWIPS_PER_IN,
              right: TWIPS_PER_IN,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${title}, ${input.orgName}`, size: 16, color: "888888" }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
                ],
              }),
            ],
          }),
        },
        children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...body],
      },
    ],
  });
  return Packer.toBuffer(document);
}

/** "Q3 / budget" -> "Q3 - budget.docx". */
export function noteFilename(title: string, extension: "docx" | "md" | "pdf"): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "Untitled note";
  return `${base.slice(0, 120)}.${extension}`;
}
