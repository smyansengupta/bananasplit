/**
 * File references in task titles and descriptions. Pure and client-safe.
 *
 * A reference is a markdown link whose target keeps its own scheme —
 * `[Budget.xlsx](file:ckxyz)` for an uploaded file, `[Build log](note:ck123)`
 * for a note — written by typing `/` in the title or the description and
 * picking from the club's Files, the way `@` picks a member and `#` makes a
 * tag. Three sigils, three things: who, what it is about, and what to read.
 *
 * Both kinds live on the Files page, so the picker offers them together and
 * the chip says which it is by where it goes.
 *
 * The description renders them through TaskMarkdown, which turns the link
 * into a chip. A title is plain text nearly everywhere it appears, so
 * <TaskTitle> renders it instead, and anywhere a title has to be text and
 * nothing else — an email, a notification, an accessible name —
 * fileRefsToPlainText leaves the name behind and takes the markup away.
 *
 * Nothing is stored alongside the task: the reference IS the text. A file
 * that is deleted leaves the name it had, which is the honest thing to show
 * and is what a renamed file shows too until someone edits the text.
 */

/** What a reference points at. Both are things on the Files page. */
export type FileRefKind = "file" | "note";

/** `[name](file:id)` or `[name](note:id)`. No bracket or newline in the name. */
const TOKEN = /\[([^\][\n]{1,120})\]\((file|note):([A-Za-z0-9_-]{1,64})\)/g;

export interface ParsedFileRef {
  kind: FileRefKind;
  id: string;
  /** The name as it was written into the text. */
  name: string;
}

/** Every distinct thing referenced, in order of first appearance. */
export function parseFileRefs(text: string | null | undefined): ParsedFileRef[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: ParsedFileRef[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const kind = match[2] as FileRefKind;
    const id = match[3]!;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id, name: match[1]! });
  }
  return out;
}

/** The token for a file or a note, with the characters that would break it removed. */
export function fileRefToken(name: string, kind: FileRefKind, id: string): string {
  const clean =
    name
      .replace(/[[\]()\n\r]/g, "")
      .trim()
      .slice(0, 120) || kind;
  return `[${clean}](${kind}:${id})`;
}

/** What a `file:<id>` or `note:<id>` link target points at, or null. */
export function fileHrefRef(
  href: string | null | undefined,
): { kind: FileRefKind; id: string } | null {
  const m = /^(file|note):([A-Za-z0-9_-]{1,64})$/.exec(href ?? "");
  return m ? { kind: m[1] as FileRefKind, id: m[2]! } : null;
}

/** Where a reference goes: the file's own page, or the note. */
export function fileRefHref(orgSlug: string, kind: FileRefKind, id: string): string {
  return kind === "note" ? `/app/${orgSlug}/notes/${id}` : `/app/${orgSlug}/notes/files/${id}`;
}

/** Replaces references with the name, for plain-text contexts. */
export function fileRefsToPlainText(text: string): string {
  return text.replace(TOKEN, (_all, name: string) => name);
}

export type TitlePart = { kind: "text"; text: string } | { kind: "ref"; ref: ParsedFileRef };

/**
 * A title split into the runs of plain text and the references between
 * them, which is what <TaskTitle> walks to render it.
 */
export function splitFileRefs(text: string): TitlePart[] {
  const parts: TitlePart[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    if (start > at) parts.push({ kind: "text", text: text.slice(at, start) });
    parts.push({
      kind: "ref",
      ref: { kind: match[2] as FileRefKind, id: match[3]!, name: match[1]! },
    });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

/** Whether the text holds a reference at all (the cheap check before splitting). */
export function hasFileRef(text: string | null | undefined): boolean {
  return Boolean(text) && /\((?:file|note):[A-Za-z0-9_-]{1,64}\)/.test(text!);
}
