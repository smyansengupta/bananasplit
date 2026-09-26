/**
 * @mentions in task descriptions and comments. Pure and client-safe.
 *
 * The editor inserts the markdown token  @[Name](user:id)  from a member
 * popover. The server re-parses the saved text (ignoring fenced and inline
 * code), keeps only ids that are members of the org, diffs them against the
 * TaskMention rows already stored for that source ('desc' or a comment id)
 * and notifies only the newly mentioned, never the author.
 */

const TOKEN = /@\[([^\]\n]{1,80})\]\(user:([A-Za-z0-9_-]{1,64})\)/g;

export const MAX_MENTIONS_PER_SOURCE = 25;

/** Removes fenced code blocks and inline code spans (mentions there are text). */
export function stripCode(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) fence = null;
      out.push("");
      continue;
    }
    if (m) {
      fence = m[1]!;
      out.push("");
      continue;
    }
    out.push(line.replace(/(`+)[\s\S]*?\1/g, ""));
  }
  return out.join("\n");
}

export interface ParsedMention {
  userId: string;
  name: string;
}

/** Every distinct mentioned user, in order of first appearance. */
export function parseMentions(markdown: string | null | undefined): ParsedMention[] {
  if (!markdown) return [];
  const seen = new Set<string>();
  const out: ParsedMention[] = [];
  for (const match of stripCode(markdown).matchAll(TOKEN)) {
    const userId = match[2]!;
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, name: match[1]! });
    if (out.length >= MAX_MENTIONS_PER_SOURCE) break;
  }
  return out;
}

export function parseMentionIds(markdown: string | null | undefined): string[] {
  return parseMentions(markdown).map((m) => m.userId);
}

/** Added and removed user ids between the stored and the new set. */
export function diffMentions(
  existing: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(existing);
  const after = new Set(next);
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}

/**
 * Who to notify after a save: newly added mentions of current members,
 * never the author.
 */
export function mentionsToNotify(
  existing: readonly string[],
  nextValid: readonly string[],
  actorId: string,
): string[] {
  return diffMentions(existing, nextValid).added.filter((id) => id !== actorId);
}

/** The token for a member, with characters that would break it removed. */
export function mentionToken(name: string, userId: string): string {
  const clean =
    name
      .replace(/[[\]()\n\r]/g, "")
      .trim()
      .slice(0, 80) || "member";
  return `@[${clean}](user:${userId})`;
}

/** The user id of a `user:<id>` link target, or null. */
export function mentionHrefUserId(href: string | null | undefined): string | null {
  const m = /^user:([A-Za-z0-9_-]{1,64})$/.exec(href ?? "");
  return m ? m[1]! : null;
}

/** Replaces tokens with "@Name" for plain-text contexts (emails, previews). */
export function mentionsToPlainText(markdown: string): string {
  return markdown.replace(TOKEN, (_all, name: string) => `@${name}`);
}
