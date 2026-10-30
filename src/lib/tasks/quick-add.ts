import { parseDueText } from "./due-text";

/**
 * One typed line, a whole task: "Order bolts @priya fri #venue" is the
 * title "Order bolts", owned by Priya, due this Friday, tagged venue. The
 * quick add on the List, at the top of each board column and in the New task
 * title all read it, so you never open a field for the three things a task
 * nearly always has.
 *
 * - `@name` is the owner: a member whose first name, or whole name without
 *   spaces, starts with what you typed. Only when it fits exactly one
 *   person; otherwise the text stays in the title as typed.
 * - A date at the end ("fri", "tomorrow", "next thu", "in 3 days", "Oct 16",
 *   optionally after "due", "by" or "on") is the due date, read with the same
 *   parser as the date menu. Only at the end, and only if a title is left.
 * - `#tags` are left in for the tag resolver (useHashTags), which makes or
 *   finds them.
 *
 * Pure: no React, no clock (today comes in).
 */

export interface QuickAddMember {
  id: string;
  name: string | null;
}

export interface QuickAdd {
  /** The title with the owner and date taken out (tags still in). */
  title: string;
  ownerId: string | null;
  /** Who `@` matched, for the preview line. */
  ownerName: string | null;
  dueKey: string | null;
}

const MENTION = /(^|\s)@([\p{L}\p{N}._'-]+)/gu;
const DATE_LEAD = new Set(["due", "by", "on"]);

function matchMember(token: string, members: readonly QuickAddMember[]) {
  const t = token.toLowerCase().replace(/[._'-]/g, "");
  if (!t) return null;
  const hits = members.filter((m) => {
    const name = (m.name ?? "").toLowerCase();
    if (!name) return false;
    const first = name.split(/\s+/)[0] ?? "";
    return first.startsWith(t) || name.replace(/[\s._'-]/g, "").startsWith(t);
  });
  if (hits.length === 1) return hits[0]!;
  // "@sam" with Sam and Samira: the exact first name wins.
  const exact = hits.filter((m) => (m.name ?? "").toLowerCase().split(/\s+/)[0] === t);
  return exact.length === 1 ? exact[0]! : null;
}

export function parseQuickAdd(
  text: string,
  todayKey: string,
  members: readonly QuickAddMember[],
): QuickAdd {
  let title = text.replace(/\s+/g, " ").trim();
  let ownerId: string | null = null;
  let ownerName: string | null = null;

  // The first @ that names exactly one member is the owner.
  for (const m of title.matchAll(MENTION)) {
    const member = matchMember(m[2]!, members);
    if (!member) continue;
    ownerId = member.id;
    ownerName = member.name;
    const at = m.index! + m[1]!.length;
    title = `${title.slice(0, at)}${title.slice(at + 1 + m[2]!.length)}`
      .replace(/\s+/g, " ")
      .trim();
    break;
  }

  // A date at the end: the longest tail (up to three words) the date menu
  // understands, with "due", "by" or "on" before it taken too. Tags after
  // it ("fri #venue") don't stop it.
  let dueKey: string | null = null;
  const words = title.split(" ");
  const tagTail: string[] = [];
  while (words.length > 0 && words[words.length - 1]!.startsWith("#"))
    tagTail.unshift(words.pop()!);
  for (let n = Math.min(3, words.length - 1); n >= 1; n -= 1) {
    const tail = words.slice(words.length - n).join(" ");
    const key = parseDueText(tail, todayKey);
    if (!key) continue;
    let keep = words.slice(0, words.length - n);
    if (keep.length > 1 && DATE_LEAD.has(keep[keep.length - 1]!.toLowerCase())) {
      keep = keep.slice(0, -1);
    }
    if (keep.join(" ").trim().length === 0) break;
    dueKey = key;
    title = [...keep, ...tagTail].join(" ");
    break;
  }

  return { title, ownerId, ownerName, dueKey };
}
