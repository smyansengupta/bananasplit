import type { EventKind, EventVisibility, Prisma, Role, RSVPStatus } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Calendar reads. Every function takes the caller's transaction client
 * (ctx.db from withOrgTx / withOrgAction, or withSystemOrgTx for the public
 * poll page) and the org id; RLS scopes them to that org either way.
 */

/**
 * An event's relations as `viewerId` may see them. Linked notes follow the
 * notes rules (0A Fix 11): deleted notes never, and PRIVATE notes only for
 * their author, regardless of role.
 */
export function eventInclude(viewerId: string) {
  return {
    attendees: {
      select: { userId: true, rsvp: true, user: { select: userPublicSelect } },
    },
    host: { select: userPublicSelect },
    notes: {
      where: {
        deletedAt: null,
        OR: [{ visibility: "ORGANIZATION" as const }, { authorId: viewerId }],
      },
      select: { id: true, title: true },
      orderBy: { createdAt: "asc" as const },
    },
  } satisfies Prisma.EventInclude;
}

export type EventWithRelations = Prisma.EventGetPayload<{
  include: ReturnType<typeof eventInclude>;
}>;

/** What the calendar grid needs per event: no attendees, no notes. */
export const calendarEventSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  kind: true,
  visibility: true,
  location: true,
  googleSyncState: true,
  needsReview: true,
} satisfies Prisma.EventSelect;

export type CalendarEventSummary = Prisma.EventGetPayload<{ select: typeof calendarEventSelect }>;

/** At most this many events per window (a month grid is a few dozen). */
export const CALENDAR_WINDOW_LIMIT = 1000;

export interface RangeFilter {
  from: Date;
  to: Date;
  kinds?: readonly EventKind[];
  visibility?: EventVisibility | null;
}

/**
 * The range-windowed filter: events overlapping [from, to), i.e.
 * startsAt < to AND endsAt > from, live and unmerged, optionally by kind
 * and visibility.
 */
export function rangeWhere(organizationId: string, f: RangeFilter): Prisma.EventWhereInput {
  return {
    organizationId,
    deletedAt: null,
    mergedIntoId: null,
    startsAt: { lt: f.to },
    endsAt: { gt: f.from },
    ...(f.kinds && f.kinds.length > 0 ? { kind: { in: [...f.kinds] } } : {}),
    ...(f.visibility ? { visibility: f.visibility } : {}),
  };
}

export function getEventsInRange(db: TxClient, organizationId: string, f: RangeFilter) {
  return db.event.findMany({
    where: rangeWhere(organizationId, f),
    select: calendarEventSelect,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: CALENDAR_WINDOW_LIMIT,
  });
}

/** The next `limit` events that have not ended yet (one under way included), for the overview. */
export function getUpcomingEvents(db: TxClient, organizationId: string, now: Date, limit: number) {
  return db.event.findMany({
    where: { organizationId, deletedAt: null, mergedIntoId: null, endsAt: { gt: now } },
    select: calendarEventSelect,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: limit,
  });
}

/**
 * The viewer's OWN answer for each of these events, so the grid can show an
 * RSVP at a glance without shipping the attendee list. A separate query
 * rather than an include: sibling includes run concurrently, which a single
 * transaction connection cannot do (see getEventById).
 */
export async function getViewerRsvps(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  eventIds: readonly string[],
): Promise<Map<string, RSVPStatus>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db.eventAttendee.findMany({
    where: { organizationId, userId: viewerId, eventId: { in: [...eventIds] } },
    select: { eventId: true, rsvp: true },
  });
  return new Map(rows.map((row) => [row.eventId, row.rsvp]));
}

/**
 * One event with its relations, as `viewerId` may see them. The relations
 * are read one query at a time: Prisma runs sibling includes concurrently,
 * which a single transaction connection cannot do.
 */
export async function getEventById(
  db: TxClient,
  organizationId: string,
  eventId: string,
  viewerId: string,
): Promise<EventWithRelations | null> {
  const include = eventInclude(viewerId);
  const event = await db.event.findFirst({ where: { id: eventId, organizationId, deletedAt: null } });
  if (!event) return null;
  const attendees = await db.eventAttendee.findMany({
    where: { organizationId, eventId },
    select: include.attendees.select,
    orderBy: { userId: "asc" },
  });
  const host = event.hostUserId
    ? await db.user.findUnique({ where: { id: event.hostUserId }, select: include.host.select })
    : null;
  const notes = await db.note.findMany({
    where: { organizationId, eventId, ...include.notes.where },
    select: include.notes.select,
    orderBy: include.notes.orderBy,
  });
  return { ...event, attendees, host, notes };
}

/**
 * Who may create, edit, move and delete events: OWNER and ADMIN (the event
 * service's events.write). The event argument is kept for call sites that
 * pass it; ownership no longer grants editing.
 */
export function canEditEvent(
  _event: unknown,
  viewer: { userId?: string; role: Role | string | null | undefined },
): boolean {
  return can({ role: viewer.role as Role | null | undefined }, "events.write");
}

/**
 * The polls list: titles, status, the span of dates on offer, the meeting
 * length and how many people (not answers: one person answers many slots)
 * have responded.
 */
export async function getOrgPolls(db: TxClient, organizationId: string) {
  const polls = await db.availabilityPoll.findMany({
    where: { organizationId },
    select: {
      id: true,
      title: true,
      timezone: true,
      durationMinutes: true,
      closesAt: true,
      finalizedEventId: true,
      finalizedEvent: { select: { startsAt: true, endsAt: true } },
      createdById: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (polls.length === 0) return [];
  const pollIds = polls.map((p) => p.id);
  const [spans, respondents] = await Promise.all([
    db.pollSlot.groupBy({
      by: ["pollId"],
      where: { organizationId, pollId: { in: pollIds } },
      _min: { startsAt: true },
      _max: { endsAt: true },
    }),
    // One row per (poll, person): members by user id, guests by key (or, for
    // rows from before guest keys, by name).
    db.pollResponse.groupBy({
      by: ["pollId", "userId", "guestKeyHash", "guestName"],
      where: { organizationId, pollId: { in: pollIds } },
    }),
  ]);
  const spanOf = new Map(spans.map((s) => [s.pollId, { from: s._min.startsAt, to: s._max.endsAt }]));
  const respondentCount = new Map<string, number>();
  for (const r of respondents) respondentCount.set(r.pollId, (respondentCount.get(r.pollId) ?? 0) + 1);
  return polls.map((p) => ({
    ...p,
    firstSlotAt: spanOf.get(p.id)?.from ?? null,
    lastSlotEndsAt: spanOf.get(p.id)?.to ?? null,
    respondentCount: respondentCount.get(p.id) ?? 0,
  }));
}

/**
 * A poll with what buildPollView (src/lib/polls/poll-view.ts) needs, plus
 * the org and creator for the caller's own checks. Never hand this to a
 * client component: it holds user ids and guest key hashes. Build the DTO.
 */
export function getPollSource(db: TxClient, organizationId: string, pollId: string) {
  return db.availabilityPoll.findFirst({
    where: { id: pollId, organizationId },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      title: true,
      description: true,
      timezone: true,
      durationMinutes: true,
      closesAt: true,
      finalizedEventId: true,
      // When the poll was scheduled for; buildPollView shows it to members only.
      finalizedEvent: { select: { startsAt: true, endsAt: true } },
      slots: {
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: "asc" },
      },
      responses: {
        select: {
          slotId: true,
          userId: true,
          guestName: true,
          guestKeyHash: true,
          availability: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}
