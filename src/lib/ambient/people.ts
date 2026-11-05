/**
 * When the People ambient buttons show (Buttons canvas, People and org
 * chart): Say hi and Add to a team for someone new, Resend invite on an
 * invite left three days, Give them a task, Check in, Hand one off, and
 * Members settings' Fix role. Pure, so the pages decide and the tests pin it.
 */

const DAY = 86_400_000;

/** "Joined this week": within the last seven days. */
export const NEW_MEMBER_DAYS = 7;
/** An invite counts as waiting too long from this many days after it was sent. */
export const INVITE_STALE_DAYS = 3;
/** Active: in the app within this many days. */
export const ACTIVE_DAYS = 7;
/** Away: not in the app for this many days. */
export const AWAY_DAYS = 30;
/** Too much on their plate: this many open tasks they own. */
export const HEAVY_TASKS = 8;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY));
}

function first(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "them";
}

/** Someone who joined within the week (not you). */
export function joinedThisWeek(joinedAt: string, now: Date): boolean {
  const d = daysSince(joinedAt, now);
  return d !== null && d < NEW_MEMBER_DAYS;
}

/** "Joined 2 days ago, no team yet". */
export function newcomerReason(joinedAt: string, hasTeam: boolean, now: Date): string {
  const d = daysSince(joinedAt, now) ?? 0;
  const when = d === 0 ? "Joined today" : d === 1 ? "Joined yesterday" : `Joined ${d} days ago`;
  return hasTeam ? when : `${when}, no team yet`;
}

/** UpNextDismissal.kind for "stop showing me this newcomer" (refId: their user id). */
export const NEWCOMER_DISMISSAL = "newcomer";

/** The hello Say hi sends. */
export function sayHiText(orgName: string): string {
  return `Welcome to ${orgName}! Glad you're here. Shout if you need anything.`;
}

/**
 * Days since an invite went out (its last send: a resend restarts the
 * expiry), when it has waited long enough for Resend invite; null otherwise.
 */
export function staleInviteDays(sentAt: string, now: Date): number | null {
  const d = daysSince(sentAt, now);
  return d !== null && d >= INVITE_STALE_DAYS ? d : null;
}

/** "Invited 4 days ago". */
export function inviteReason(days: number): string {
  return `Invited ${days} days ago`;
}

export interface Activity {
  online: boolean;
  /** ISO, or null when never seen here. */
  lastSeenAt: string | null;
  joinedAt: string;
}

/** Around lately: online, or seen within the week. */
export function isActive(a: Activity, now: Date): boolean {
  if (a.online) return true;
  const d = daysSince(a.lastSeenAt, now);
  return d !== null && d < ACTIVE_DAYS;
}

/** Give them a task: around lately, and nothing open. */
export function needsATask(a: Activity & { openTasks: number }, now: Date): boolean {
  return a.openTasks === 0 && isActive(a, now);
}

/** Check in: not seen for 30 days (or never, a month after joining). */
export function awayDays(a: Activity, now: Date): number | null {
  if (a.online) return null;
  const d = daysSince(a.lastSeenAt ?? a.joinedAt, now);
  return d !== null && d >= AWAY_DAYS ? d : null;
}

/** The note Check in sends. */
export function checkInText(name: string | null | undefined): string {
  return `Hi ${first(name)}, haven't seen you around in a while. Everything all right? Anything I can help with?`;
}

/** Hand one off: they own this many open tasks or more. */
export function tooMuchOnPlate(ownedOpen: number): boolean {
  return ownedOpen >= HEAVY_TASKS;
}

/**
 * Who to hand a task to: the member with the fewest open tasks they own,
 * not the person handing off (ties by name).
 */
export function lightestMember<T extends { id: string; name: string | null; open: number }>(
  members: readonly T[],
  except: string,
): T | null {
  const others = members.filter((m) => m.id !== except);
  if (others.length === 0) return null;
  return [...others].sort(
    (a, b) => a.open - b.open || (a.name ?? "").localeCompare(b.name ?? ""),
  )[0]!;
}

type SeatRole = "ADMIN" | "TREASURER";
const RANK: Record<string, number> = { MEMBER: 0, TREASURER: 1, ADMIN: 2, OWNER: 3 };

const MONEY_SEAT = /\b(treasurer|finance|financial|cfo|bursar)\b/i;
const LEAD_SEAT = /\b(president|chair|co-?chair|chairperson|founder|executive director|head)\b/i;

/**
 * The role a seat calls for: a money seat (Treasurer, VP Finance) needs
 * Finance, a seat at the top of the chart (President, Chair) runs the
 * organization. Null when the title says nothing about access.
 */
export function roleForSeat(seat: {
  title: string;
  top: boolean;
  isAdvisor: boolean;
}): SeatRole | null {
  if (seat.isAdvisor) return null;
  if (MONEY_SEAT.test(seat.title)) return "TREASURER";
  if (seat.top && LEAD_SEAT.test(seat.title)) return "ADMIN";
  return null;
}

/**
 * Fix role: their role gives less than their seat needs (a Member in the
 * Treasurer seat can't open Finance). Never suggests taking access away.
 */
export function roleFix(
  role: string,
  seats: readonly { title: string; top: boolean; isAdvisor: boolean }[],
): { to: SeatRole; seat: string; reason: string } | null {
  let best: { to: SeatRole; seat: string } | null = null;
  for (const seat of seats) {
    const to = roleForSeat(seat);
    if (to && (RANK[to] ?? 0) > (RANK[best?.to ?? "MEMBER"] ?? 0)) best = { to, seat: seat.title };
  }
  if (!best || (RANK[role] ?? 0) >= RANK[best.to]!) return null;
  const roleWord = role.charAt(0) + role.slice(1).toLowerCase();
  return { ...best, reason: `Holds the ${best.seat} seat, role is ${roleWord}` };
}
