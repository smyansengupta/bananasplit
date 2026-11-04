import { z } from "zod";

import { addDaysToKey } from "@/lib/calendar/dates";
import { cleanDay, cleanText } from "@/lib/crm/ai-outputs";

/**
 * A note becomes a task (docs/features/crm.md, "Notes and tasks"): what the
 * model must answer, and the plain rules that read a note when there's no
 * AI key, find the member it's for ("for Kristine") and clean whatever came
 * back before anyone sees it. Pure and client-safe: the card's preview and
 * the server share the types.
 */

export const NOTE_TASK_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type NoteTaskPriority = (typeof NOTE_TASK_PRIORITIES)[number];

export const TaskDraftOutput = z.object({
  /** A clear, short title: the job to do, not the complaint. */
  title: z.string(),
  /** Two or three sentences: names the person or company and quotes the note. */
  description: z.string(),
  /** A member's name exactly as listed in <members>, or null. */
  assignee: z.string().nullable(),
  /** Why them, in a few words ("Owns exports"). */
  assigneeWhy: z.string().nullable(),
  /** YYYY-MM-DD when the note says or implies a day, else null. */
  dueDate: z.string().nullable(),
  priority: z.enum(NOTE_TASK_PRIORITIES),
  notes: z.array(z.string()),
});
export type TaskDraftData = z.infer<typeof TaskDraftOutput>;

export interface TaskMember {
  id: string;
  name: string;
  /** Their title on the org chart. */
  title?: string | null;
  /** What they're responsible for on the org chart. */
  areas?: readonly string[];
}

/** What the card's preview shows and edits before Create task. */
export interface NoteTaskDraft {
  title: string;
  description: string;
  ownerId: string | null;
  /** Why that member: "Named in the note", "Owns exports", "Owns Marcus". */
  ownerWhy: string | null;
  dueDate: string | null;
  priority: NoteTaskPriority;
  /** Written by the organization's AI (false: read plainly from the note). */
  ai: boolean;
  model: string | null;
  /** No AI key yet: say AI can write it once one is added. */
  noKey: boolean;
  /** The note it came from (null: typed in the composer's Task channel). */
  noteId: string | null;
}

export interface NoteTaskContext {
  /** The note, or what was typed in the Task channel. */
  text: string;
  record: {
    kind: "person" | "company";
    name: string;
    company: string | null;
    ownerId: string | null;
  };
  members: readonly TaskMember[];
  viewerId: string;
  /** Today in the organization's timezone, YYYY-MM-DD. */
  today: string;
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The member a name means: their full name, else the one member with that
 * first name, else the one whose name starts with it. Null when nobody or
 * more than one fits.
 */
export function matchMember(
  name: string | null | undefined,
  members: readonly TaskMember[],
): TaskMember | null {
  const n = norm(name ?? "").replace(/^@/, "");
  if (!n) return null;
  const full = members.filter((m) => norm(m.name) === n);
  if (full.length === 1) return full[0]!;
  const first = members.filter((m) => norm(m.name).split(" ")[0] === n);
  if (first.length === 1) return first[0]!;
  if (n.length < 3) return null;
  const prefix = members.filter((m) => norm(m.name).startsWith(n));
  return prefix.length === 1 ? prefix[0]! : null;
}

/** The words that hand a task to someone: "for Kristine", "@Kristine", "assign to Kristine", "ask Kristine to". */
const HANDOFF =
  /(?:^|[\s,;(-])(?:(?:for|assign(?:ed)?\s+(?:it\s+)?to|give\s+(?:it\s+)?to|ask|cc)\s+|@)([A-Za-z][A-Za-z'-]*)/gi;

/**
 * The member a note names as the one to do it ("... for Kristine"), and the
 * note without those words. Only names that are members count, so "for
 * Marcus" (the contact) or "for now" leave the text alone.
 */
export function assigneeFromText(
  text: string,
  members: readonly TaskMember[],
): { member: TaskMember | null; rest: string } {
  for (const m of text.matchAll(HANDOFF)) {
    const nameStart = m.index! + m[0].length - m[1]!.length;
    // "for Kristine Lee" or just "for Kristine" (the next word may be the sentence going on).
    const next = /^\s+([A-Za-z][A-Za-z'-]*)/.exec(text.slice(nameStart + m[1]!.length))?.[1];
    const tries = next ? [`${m[1]} ${next}`, m[1]!] : [m[1]!];
    for (const t of tries) {
      const member = matchMember(t, members);
      if (!member) continue;
      const start = m.index! + (m[0].length - m[0].trimStart().length);
      const end = nameStart + t.length;
      const rest = (text.slice(0, start) + text.slice(end))
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/[,;:]+([.;:!?])/g, "$1")
        .replace(/[\s,;:-]+$/g, "")
        .replace(/^[\s,;:-]+/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return { member, rest };
    }
  }
  return { member: null, rest: text.trim() };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function weekdayOf(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

/**
 * A day the note says or implies, plainly: today, tomorrow, next week,
 * end of the week or month, in N days, a weekday ("by Friday": the next
 * one), or a written date (2026-11-20). Null when it says none.
 */
export function impliedDue(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso && cleanDay(iso[1]) && iso[1]! >= today) return iso[1]!;
  if (/\b(today|tonight|asap|right away|end of (the )?day|eod)\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDaysToKey(today, 1);
  const inDays = /\bin (\d{1,2}|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/.exec(
    t,
  );
  if (inDays) {
    const words: Record<string, number> = {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
    };
    const n = Number(inDays[1]) || words[inDays[1]!] || 1;
    return addDaysToKey(today, inDays[2]!.startsWith("week") ? n * 7 : n);
  }
  if (/\bnext week\b/.test(t)) return addDaysToKey(today, 7);
  if (/\b(end of (the )?week|this week|eow)\b/.test(t)) {
    const d = weekdayOf(today);
    return addDaysToKey(today, d <= 5 ? 5 - d : 6);
  }
  if (/\b(end of (the )?month|this month)\b/.test(t)) {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${today.slice(0, 8)}${String(last).padStart(2, "0")}`;
  }
  const day = new RegExp(`\\b(by|on|before|this|next|until)\\s+(${WEEKDAYS.join("|")})\\b`).exec(t);
  if (day) {
    const want = WEEKDAYS.indexOf(day[2]!);
    let ahead = (want - weekdayOf(today) + 7) % 7 || 7;
    if (day[1] === "next" && ahead < 7) ahead += 7;
    return addDaysToKey(today, ahead);
  }
  return null;
}

/** High when the note sounds urgent or at risk, low when it says it can wait. */
export function impliedPriority(text: string): NoteTaskPriority {
  const t = text.toLowerCase();
  if (
    /\b(urgent|asap|right away|blocker|blocking|broken|angry|furious|upset|cancel|cancell?ing|churn|leaving|refund|escalat\w*|deadline)\b/.test(
      t,
    )
  ) {
    return "HIGH";
  }
  if (/\b(someday|eventually|no rush|nice to have|whenever|low priority)\b/.test(t)) return "LOW";
  return "MEDIUM";
}

/** The note's first sentence as a title, capped at 90 characters. */
export function titleFromText(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const sentence = (/^(.+?[.!?])(\s|$)/.exec(one)?.[1] ?? one).replace(/[.!?]+$/, "");
  const t = sentence.length > 90 ? `${sentence.slice(0, 89).trimEnd()}…` : sentence;
  return t ? t[0]!.toUpperCase() + t.slice(1) : "Follow up";
}

function quoted(text: string, max = 600): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

function about(record: NoteTaskContext["record"]): string {
  return record.kind === "person" && record.company
    ? `${record.name} (${record.company})`
    : record.name;
}

/** The fallback owner: the record's owner while a member, else whoever is writing it. */
function fallbackOwner(ctx: NoteTaskContext): { id: string; why: string } {
  const owner = ctx.record.ownerId ? ctx.members.find((m) => m.id === ctx.record.ownerId) : null;
  if (owner) return { id: owner.id, why: `Owns ${ctx.record.name.split(" ")[0]}` };
  return { id: ctx.viewerId, why: "You wrote it" };
}

/** A task read plainly from the note (no AI key, or the local stand-in). */
export function plainTaskDraft(
  ctx: NoteTaskContext,
  noteId: string | null,
  noKey: boolean,
): NoteTaskDraft {
  const named = assigneeFromText(ctx.text, ctx.members);
  const owner = named.member
    ? { id: named.member.id, why: "Named in the note" }
    : fallbackOwner(ctx);
  return {
    title: titleFromText(named.rest || ctx.text),
    description: `From a note on ${about(ctx.record)}: "${quoted(named.rest || ctx.text)}"`,
    ownerId: owner.id,
    ownerWhy: owner.why,
    dueDate: impliedDue(ctx.text, ctx.today),
    priority: impliedPriority(ctx.text),
    ai: false,
    model: null,
    noKey,
    noteId,
  };
}

/**
 * The model's answer as a preview: title and description cleaned and
 * capped, the description made to name the record and quote the note when
 * the model left either out, the assignee mapped to a member (a name in the
 * note wins, then the model's pick, then the record's owner, then the
 * writer), a due date only when it's a real day from today on.
 */
export function cleanTaskDraft(
  data: TaskDraftData,
  ctx: NoteTaskContext,
  meta: { noteId: string | null; model: string | null },
): NoteTaskDraft {
  const named = assigneeFromText(ctx.text, ctx.members);
  const picked = matchMember(data.assignee, ctx.members);
  const owner = named.member
    ? { id: named.member.id, why: "Named in the note" }
    : picked
      ? { id: picked.id, why: cleanText(data.assigneeWhy, 80) ?? "Picked by AI" }
      : fallbackOwner(ctx);
  const plain = plainTaskDraft(ctx, meta.noteId, false);
  let description = cleanText(data.description, 2000) ?? plain.description;
  const first = ctx.record.name.split(" ")[0]!.toLowerCase();
  if (!description.toLowerCase().includes(first))
    description = `${about(ctx.record)}: ${description}`;
  if (!/["“”]/.test(description))
    description = `${description}\n\nThe note: "${quoted(named.rest || ctx.text)}"`;
  const due = cleanDay(data.dueDate);
  return {
    title: cleanText(data.title, 120)?.replace(/[.]+$/, "") ?? plain.title,
    description,
    ownerId: owner.id,
    ownerWhy: owner.why,
    dueDate: due && due >= ctx.today ? due : null,
    priority: (NOTE_TASK_PRIORITIES as readonly string[]).includes(data.priority)
      ? data.priority
      : plain.priority,
    ai: true,
    model: meta.model,
    noKey: false,
    noteId: meta.noteId,
  };
}

/** The members as the prompt lists them: name, title and what they own. */
export function membersBlock(members: readonly TaskMember[]): string {
  return members
    .slice(0, 80)
    .map((m) => {
      const bits = [
        m.title,
        m.areas?.length ? `responsible for ${m.areas.slice(0, 5).join("; ")}` : null,
      ].filter(Boolean);
      return `- ${m.name}${bits.length ? `: ${bits.join(", ")}` : ""}`;
    })
    .join("\n");
}
