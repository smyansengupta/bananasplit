import { can } from "@/lib/auth/permissions";
import { addDaysToKey, localDateKey, zonedInstant } from "@/lib/tasks/dates";
import type { Role } from "@/generated/prisma/enums";

/**
 * Announcements' rules, free of the database so they can be tested on their
 * own: what a post may say, who may change or put back one, and the
 * one-line fact the Inbox shows under a post, which of the card's two views
 * is open, and when it offers this week's recap. The database enforces the
 * same who-may rules (prisma/migrations/20261102100000_home_widgets).
 */

export const TITLE_MAX = 200;
export const BODY_MAX = 10_000;
/** The Inbox shows posts from this many days back. */
export const RECENT_DAYS = 14;
/** And at most this many of them before "See all". */
export const INBOX_LIMIT = 3;

export type AnnouncementDraft = { title: string; body: string };

/** The title and body cleaned up, or what's wrong with them. */
export function cleanAnnouncement(
  input: unknown,
): { ok: true; draft: AnnouncementDraft } | { ok: false; error: string } {
  const raw = (input ?? {}) as { title?: unknown; body?: unknown };
  const title = typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim() : "";
  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n/g, "\n").trim() : "";
  if (!title) return { ok: false, error: "Give it a title." };
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Keep the title to ${TITLE_MAX} characters.` };
  }
  if (body.length > BODY_MAX) {
    return { ok: false, error: `Keep it to ${BODY_MAX.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, draft: { title, body } };
}

/** Whoever posted it, or an owner or admin, edits and removes a post. */
export function canManageAnnouncement(
  actor: { userId: string; role: Role | null },
  post: { authorId: string | null },
): boolean {
  return post.authorId === actor.userId || can(actor, "events.write");
}

/**
 * Whoever took a post down, or an owner or admin, puts it back: an author
 * can't undo an admin's removal.
 */
export function canRestoreAnnouncement(
  actor: { userId: string; role: Role | null },
  post: { deletedById: string | null },
): boolean {
  return (
    (post.deletedById !== null && post.deletedById === actor.userId) || can(actor, "events.write")
  );
}

/**
 * When it went out, as a post's byline says it: "today", "yesterday", a
 * weekday within the week ("Tue"), else the date ("Oct 26"), in `timeZone`.
 */
export function postedWhen(at: Date, now: Date, timeZone: string): string {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(d);
  const dayNumber = (d: Date) => Date.parse(`${key(d)}T00:00:00Z`) / 86_400_000;
  const days = dayNumber(now) - dayNumber(at);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(at);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
}

/** "Kristine, Tue": the author's first name and when. */
export function byline(authorName: string | null | undefined, when: string): string {
  const first = authorName?.trim().split(/\s+/)[0];
  return `${first || "A former member"}, ${when}`;
}

/** The width of a "Seen by N of M" bar, 0 to 100. */
export function seenPercent(seen: number, members: number): number {
  if (members <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((seen / members) * 100)));
}

/**
 * The Inbox's one fact under a post that links an event: how many people
 * signed up for it in the day after it went out (or since, when it's newer
 * than a day). Null when nobody did: no sentence beats "0 people".
 */
export function signupInsight(
  signups: number,
  eventTitle: string,
  postedAt: Date,
  now: Date,
): SignupInsight | null {
  if (signups <= 0) return null;
  const fresh = now.getTime() - postedAt.getTime() < 24 * 60 * 60 * 1000;
  const people = signups === 1 ? "person" : "people";
  const when = fresh ? "since this was posted" : "in the day after this was posted";
  return { count: signups, rest: `${people} signed up for ${eventTitle} ${when}.` };
}

/** "<count> <rest>": the number is drawn bold. */
export interface SignupInsight {
  count: number;
  rest: string;
}

/**
 * The Announcements card's two views: the posts, or this week's recap
 * ("This week"). It's the Inbox's `?news=` param, so a refresh keeps it;
 * anything but "week" is the posts.
 */
export type AnnouncementsView = "posts" | "week";
export const NEWS_PARAM = "news";

export function announcementsView(param: string | string[] | undefined): AnnouncementsView {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "week" ? "week" : "posts";
}

/**
 * The end of the week, when the Inbox offers to post this week's recap:
 * Friday 00:00 through Sunday 23:59 in `timeZone` (the organization's).
 * The instant this window opened (that Friday's midnight), or null on
 * Monday to Thursday. A recap posted since then counts as this week's.
 */
export function recapWindowStart(now: Date, timeZone: string): Date | null {
  const today = localDateKey(now, timeZone);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sinceFriday = weekday === 5 ? 0 : weekday === 6 ? 1 : weekday === 0 ? 2 : null;
  if (sinceFriday === null) return null;
  return zonedInstant(addDaysToKey(today, -sinceFriday), 0, timeZone);
}
