import { cache } from "react";

import type {
  OrgKind,
  Prisma,
  RegistrationStatus,
  Role,
  RSVPStatus,
  TaskStatus,
} from "@/generated/prisma/client";
import { getUpcomingEvents, getViewerRsvps } from "@/app/app/[orgSlug]/calendar/queries";
import { isPaused, type SpaceInfo } from "@/lib/billing/space";
import { DUE_SOON_DAYS, UPCOMING_DAYS } from "@/lib/personal/home-windows";
import { profileStepHref, type ProfileStep } from "@/lib/onboarding/steps";
import { parseStoredLinks } from "@/lib/profile/links";
import { pollHref } from "@/lib/polls/paths";
import { addDaysToKey, effectiveTimezone, fromDateKey, localDateKey } from "@/lib/tasks/dates";
import { NotFoundError } from "@/lib/auth/errors";
import { withOrgTx, withUserTx, type TxClient } from "@/server/db/context";
import { listNoteFiles } from "@/server/notes/files";
import { myRsvpRegistrations, type RegistrationRow } from "@/server/rsvp/my-registrations";
import { findPendingInvitationsForMe, type PendingInvitation } from "@/server/settings/invitations";
import { taskFilterWhere } from "@/server/tasks/queries";

/**
 * The Personal dashboard's data (/app/{personal slug}; "Personal dashboard"
 * in docs/features/personal-and-clubs.md): your clubs, when you meet next,
 * your RSVPs, what's due soon, polls, and "Finish your profile".
 *
 * Row security, the whole way:
 * - Who you are and which spaces you're in: withUserTx (your own rows).
 * - Each space's events, tasks, polls and unread count: one withOrgTx per
 *   space, as its member, so RLS bounds every read to that space and to what
 *   you may see in it (private tasks stay private). The spaces are read a
 *   few at a time (SPACE_CONCURRENCY transactions at once), each one's
 *   queries one after another on its own connection.
 * - Public RSVP pages you signed up for (in any space, member or not):
 *   app.my_rsvp_registrations, a SECURITY DEFINER lookup that returns only
 *   your own sign-ups (by user id, or your verified email).
 * Every list is bounded (the limits below); a space that fails to load is
 * left out rather than failing the page.
 */

/** At most this many clubs are read for the dashboard (the rest are counted). */
export const MAX_CLUBS = 20;
/** Spaces read at once (each is one transaction, one pooled connection). */
const SPACE_CONCURRENCY = 4;

const PER_SPACE_EVENTS = 8;
const PER_SPACE_TASKS = 8;
const PER_SPACE_POLLS = 4;
const HOSTED_PAGES = 6;
const RSVP_LIMIT = 8;
const RECENT_FILES = 6;

export const UPCOMING_LIMIT = 10;
export const DUE_SOON_LIMIT = 10;
export const POLLS_LIMIT = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- shapes

/** Which space an item belongs to, for its label and links. */
export interface SpaceRef {
  id: string;
  /** "Personal" for the Personal space, else the club's name. */
  name: string;
  slug: string;
  kind: OrgKind;
  /** The space's own zone (all-day events are whole days in it). */
  timeZone: string;
}

export interface PersonalHomeEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

export interface PersonalHomeClub {
  id: string;
  name: string;
  slug: string;
  logo: unknown;
  role: Role;
  /** Your title in this club ("Treasurer"), when set. */
  title: string | null;
  /** The next meeting (a board meeting, or anything titled "... meeting"). */
  nextMeeting: PersonalHomeEvent | null;
  /** Open tasks you own or are on in this club. */
  openTasks: number;
  /** Unread notifications from this club. */
  unread: number;
  /** The trial ended before an owner chose a plan: read-only for now. */
  paused: boolean;
  /** The club's zone, for its all-day meetings. */
  timeZone: string;
}

export interface UpcomingItem extends PersonalHomeEvent {
  space: SpaceRef;
  tag: { name: string; color: string | null } | null;
  location: string | null;
  /** Your answer, where you were invited (clubs). */
  rsvp: RSVPStatus | null;
  href: string;
}

export type DueBucket = "overdue" | "today" | "soon";

export interface DueTask {
  space: SpaceRef;
  id: string;
  title: string;
  status: TaskStatus;
  /** YYYY-MM-DD (due dates are floating dates). */
  dueKey: string;
  bucket: DueBucket;
  href: string;
}

export interface WaitingPoll {
  space: SpaceRef;
  id: string;
  kind: "availability" | "question";
  title: string;
  closesAt: Date | null;
  href: string;
}

export interface OwnPoll {
  space: SpaceRef;
  id: string;
  title: string;
  /** People who have answered (members and guests). */
  respondents: number;
  closesAt: Date | null;
  href: string;
}

/** A public RSVP page you signed up for. */
export interface RsvpTicket {
  registrationId: string;
  status: Extract<RegistrationStatus, "GOING" | "WAITLIST">;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** The host club's name; null for someone's Personal page. */
  host: string | null;
  /** The page's timezone (its space's), as on the page itself. */
  timeZone: string;
  pageHref: string;
  ticketHref: string;
}

/** An RSVP page you host in Personal. */
export interface HostedPage {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  enabled: boolean;
  going: number;
  waitlist: number;
  capacity: number | null;
  manageHref: string;
  pageHref: string | null;
}

export type ProfileGap = Extract<ProfileStep, "school" | "bio" | "availability">;

export interface PersonalHomeData {
  /** The user's first name, for the greeting (null when unknown). */
  firstName: string | null;
  /** The zone the dashboard reads in (yours, else Personal's). */
  timeZone: string;
  /** Today in that zone (YYYY-MM-DD). */
  todayKey: string;
  /** Whether the email is verified: joining and starting a club need it. */
  emailVerified: boolean;
  /** Live clubs you're in, by name (at most MAX_CLUBS). */
  clubs: PersonalHomeClub[];
  /** Clubs beyond MAX_CLUBS, not read. */
  moreClubs: number;
  /** Email invites waiting for this (verified) address. */
  pendingInvites: PendingInvitation[];
  /** Events in the next UPCOMING_DAYS across Personal and your clubs. */
  upcoming: UpcomingItem[];
  /** Your open tasks due within DUE_SOON_DAYS (or overdue), across spaces. */
  dueSoon: DueTask[];
  /** How many of those there were before the list was cut. */
  dueSoonTotal: number;
  /** Polls in your clubs you haven't answered. */
  pollsWaiting: WaitingPoll[];
  /** Your own open availability polls and how many have answered. */
  ownPolls: OwnPoll[];
  /** Public pages you signed up for (going or waitlisted), soonest first. */
  rsvps: RsvpTicket[];
  /** Pages you host in Personal, coming up. */
  hosting: HostedPage[];
  /** Profile steps skipped, in order; empty when the profile is complete. */
  profileGaps: ProfileGap[];
  /** Where "Finish your profile" goes (the first gap), or null. */
  finishProfileHref: string | null;
  /** "Your week": tasks finished in the last seven days, per space (most first). */
  yourWeek: { done: number; bySpace: { space: SpaceRef; done: number }[] };
  /** Personal's newest files. */
  recentFiles: { id: string; name: string; contentType: string; createdAt: Date; href: string }[];
}

// ---------------------------------------------------------------- raw reads

interface SpaceRow {
  id: string;
  name: string;
  slug: string;
  kind: OrgKind;
  logo: Prisma.JsonValue | null;
  timezone: string;
  plan: SpaceInfo["plan"];
  trialEndsAt: Date | null;
  role: Role;
  title: string | null;
}

/** One space's slice of the dashboard, as read under its RLS. */
export interface SpaceDigest {
  events: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    tag: { name: string; color: string | null } | null;
    location: string | null;
  }[];
  rsvps: Map<string, RSVPStatus>;
  nextMeeting: PersonalHomeEvent | null;
  dueTasks: { id: string; title: string; status: TaskStatus; dueDate: Date | null }[];
  openTasks: number;
  unread: number;
  waitingAvailability: { id: string; title: string; closesAt: Date | null }[];
  waitingQuestions: { id: string; question: string; closesAt: Date | null }[];
  ownPolls: { id: string; title: string; closesAt: Date | null; respondents: number }[];
  hosted: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    rsvpEnabled: boolean;
    rsvpSlug: string | null;
    rsvpCapacity: number | null;
    going: number;
    waitlist: number;
  }[];
  /** Tasks you finished in the last seven days (yours, or ones you're on). */
  doneThisWeek?: number;
  /** Personal only: the newest files. */
  recentFiles?: { id: string; name: string; contentType: string; createdAt: Date }[];
}

export type { RegistrationRow };

export interface PersonalHomeRaw {
  user: {
    name: string | null;
    timezone: string | null;
    emailVerified: boolean;
    major: string | null;
    gradYear: number | null;
    bio: string | null;
    links: Prisma.JsonValue | null;
    hasAvailability: boolean;
  } | null;
  spaces: { space: SpaceRow; digest: SpaceDigest | null }[];
  moreClubs: number;
  registrations: RegistrationRow[];
  pendingInvites: PendingInvitation[];
}

/** Runs `fn` over `items`, at most `limit` at once, keeping the order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** One space, as its member: every read bounded, one after another. */
export async function readSpaceDigest(
  db: TxClient,
  space: Pick<SpaceRow, "id" | "kind">,
  userId: string,
  window: { now: Date; until: Date; dueBy: Date },
): Promise<SpaceDigest> {
  const club = space.kind === "CLUB";
  const organizationId = space.id;
  const { now } = window;

  const events = await db.event.findMany({
    where: {
      organizationId,
      deletedAt: null,
      mergedIntoId: null,
      endsAt: { gt: now },
      startsAt: { lt: window.until },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      tag: { select: { name: true, color: true } },
      location: true,
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: PER_SPACE_EVENTS,
  });
  const rsvps = club
    ? await getViewerRsvps(
        db,
        organizationId,
        userId,
        events.map((e) => e.id),
      )
    : new Map<string, RSVPStatus>();
  const nextMeeting = club
    ? ((await getUpcomingEvents(db, organizationId, now, 1, "meetings"))[0] ?? null)
    : null;

  // In a club: what you own or are on. In Personal: everything open (it's yours).
  const mine = taskFilterWhere(
    organizationId,
    club ? { assigneeId: userId, status: "open" } : { status: "open" },
  );
  const dueTasks = await db.task.findMany({
    where: { AND: [mine, { dueDate: { lte: window.dueBy } }] },
    select: { id: true, title: true, status: true, dueDate: true },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
    take: PER_SPACE_TASKS,
  });
  const openTasks = club ? await db.task.count({ where: mine }) : 0;
  // "Your week": what you finished in the last seven days.
  const doneThisWeek = await db.task.count({
    where: {
      AND: [
        taskFilterWhere(organizationId, club ? { assigneeId: userId } : {}),
        { status: "COMPLETED", completedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
      ],
    },
  });
  // Personal's files (Personal spaces have notes and files now).
  const recentFiles = club
    ? []
    : (await listNoteFiles(db, organizationId)).slice(0, RECENT_FILES).map((f) => ({
        id: f.id,
        name: f.name,
        contentType: f.contentType,
        createdAt: f.createdAt,
      }));
  const unread = club
    ? await db.notification.count({ where: { organizationId, userId, readAt: null } })
    : 0;

  const stillOpen = { OR: [{ closesAt: null }, { closesAt: { gt: now } }] };
  const waitingAvailability = club
    ? await db.availabilityPoll.findMany({
        where: {
          organizationId,
          finalizedEventId: null,
          createdById: { not: userId },
          responses: { none: { userId } },
          ...stillOpen,
        },
        select: { id: true, title: true, closesAt: true },
        orderBy: { createdAt: "desc" },
        take: PER_SPACE_POLLS,
      })
    : [];
  const waitingQuestions = club
    ? await db.poll.findMany({
        where: {
          organizationId,
          closedAt: null,
          createdById: { not: userId },
          votes: { none: { userId } },
          ...stillOpen,
        },
        select: { id: true, question: true, closesAt: true },
        orderBy: { createdAt: "desc" },
        take: PER_SPACE_POLLS,
      })
    : [];

  const own = await db.availabilityPoll.findMany({
    where: { organizationId, createdById: userId, finalizedEventId: null, ...stillOpen },
    select: { id: true, title: true, closesAt: true },
    orderBy: { createdAt: "desc" },
    take: PER_SPACE_POLLS,
  });
  // One row per person who answered (as getOrgPolls counts them: a NO alone
  // reads as unmarked, so it isn't an answer).
  const respondents =
    own.length > 0
      ? await db.pollResponse.groupBy({
          by: ["pollId", "userId", "guestKeyHash", "guestName"],
          where: {
            organizationId,
            pollId: { in: own.map((p) => p.id) },
            availability: { not: "NO" },
          },
        })
      : [];
  const answered = new Map<string, number>();
  for (const r of respondents) answered.set(r.pollId, (answered.get(r.pollId) ?? 0) + 1);
  const ownPolls = own.map((p) => ({ ...p, respondents: answered.get(p.id) ?? 0 }));

  // The event pages you host in Personal (you own it, so you see sign-ups).
  let hosted: SpaceDigest["hosted"] = [];
  if (!club) {
    const pages = await db.event.findMany({
      where: { organizationId, deletedAt: null, rsvpSlug: { not: null }, endsAt: { gt: now } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        rsvpEnabled: true,
        rsvpSlug: true,
        rsvpCapacity: true,
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: HOSTED_PAGES,
    });
    const counts =
      pages.length > 0
        ? await db.eventRegistration.groupBy({
            by: ["eventId", "status"],
            where: {
              organizationId,
              eventId: { in: pages.map((p) => p.id) },
              status: { in: ["GOING", "WAITLIST"] },
            },
            _count: { _all: true },
          })
        : [];
    const countOf = (eventId: string, status: RegistrationStatus) =>
      counts.find((c) => c.eventId === eventId && c.status === status)?._count._all ?? 0;
    hosted = pages.map((p) => ({
      ...p,
      going: countOf(p.id, "GOING"),
      waitlist: countOf(p.id, "WAITLIST"),
    }));
  }

  return {
    events,
    rsvps,
    nextMeeting: nextMeeting
      ? {
          id: nextMeeting.id,
          title: nextMeeting.title,
          startsAt: nextMeeting.startsAt,
          endsAt: nextMeeting.endsAt,
          allDay: nextMeeting.allDay,
        }
      : null,
    dueTasks,
    openTasks,
    unread,
    waitingAvailability,
    waitingQuestions,
    ownPolls,
    hosted,
    doneThisWeek,
    recentFiles,
  };
}

async function readRaw(userId: string, now: Date): Promise<PersonalHomeRaw> {
  const { user, spaces } = await withUserTx(userId, async ({ db }) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        timezone: true,
        emailVerified: true,
        major: true,
        gradYear: true,
        bio: true,
        links: true,
        availability: { select: { userId: true } },
      },
    });
    const memberships = await db.membership.findMany({
      where: { userId, organization: { deletedAt: null } },
      select: {
        role: true,
        title: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            kind: true,
            logo: true,
            timezone: true,
            plan: true,
            trialEndsAt: true,
            personalOwnerId: true,
          },
        },
      },
      orderBy: { organization: { name: "asc" } },
    });
    const spaces: SpaceRow[] = memberships
      .filter((m) => m.organization.kind === "CLUB" || m.organization.personalOwnerId === userId)
      .map(({ role, title, organization: { personalOwnerId: _owner, ...org } }) => ({
        ...org,
        role,
        title,
      }));
    return { user, spaces };
  });

  const personal = spaces.find((s) => s.kind === "PERSONAL") ?? null;
  const allClubs = spaces.filter((s) => s.kind === "CLUB");
  const clubs = allClubs.slice(0, MAX_CLUBS);
  const toRead = personal ? [personal, ...clubs] : clubs;

  const timeZone = effectiveTimezone(user, personal);
  const todayKey = localDateKey(now, timeZone);
  const window = {
    now,
    until: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS),
    dueBy: fromDateKey(addDaysToKey(todayKey, DUE_SOON_DAYS - 1)),
  };

  const emailVerified = Boolean(user?.emailVerified);
  const [digests, registrations, pendingInvites] = await Promise.all([
    mapLimit(toRead, SPACE_CONCURRENCY, async (space) => {
      try {
        return await withOrgTx(space.id, ({ db }) => readSpaceDigest(db, space, userId, window));
      } catch (error) {
        // Left the club a moment ago, or a transient failure: show the rest.
        if (!(error instanceof NotFoundError)) {
          console.error("[personal-home] could not read a space", space.id, error);
        }
        return null;
      }
    }),
    myRsvpRegistrations(userId, RSVP_LIMIT),
    // Pending invites are listed only for a verified address (0A Fix 4).
    emailVerified ? findPendingInvitationsForMe(userId) : Promise.resolve([]),
  ]);

  return {
    user: user
      ? {
          name: user.name,
          timezone: user.timezone,
          emailVerified,
          major: user.major,
          gradYear: user.gradYear,
          bio: user.bio,
          links: user.links,
          hasAvailability: user.availability !== null,
        }
      : null,
    spaces: toRead.map((space, i) => ({ space, digest: digests[i] })),
    moreClubs: allClubs.length - clubs.length,
    registrations,
    pendingInvites,
  };
}

// ---------------------------------------------------------------- shaping

function refOf(space: SpaceRow): SpaceRef {
  return {
    id: space.id,
    name: space.kind === "PERSONAL" ? "Personal" : space.name,
    slug: space.slug,
    kind: space.kind,
    timeZone: space.timezone,
  };
}

function dueKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketOf(dueKey: string, todayKey: string): DueBucket {
  if (dueKey < todayKey) return "overdue";
  if (dueKey === todayKey) return "today";
  return "soon";
}

/** The profile steps the user skipped, in the flow's order. */
export function profileGapsOf(user: PersonalHomeRaw["user"]): ProfileGap[] {
  if (!user) return [];
  const gaps: ProfileGap[] = [];
  if (!user.major && user.gradYear === null) gaps.push("school");
  if (!user.bio?.trim() && parseStoredLinks(user.links).length === 0) gaps.push("bio");
  if (!user.hasAvailability) gaps.push("availability");
  return gaps;
}

/**
 * The dashboard from its raw reads: merged across spaces, sorted, labelled
 * and cut to the limits. Pure, so the shaping is tested without a database.
 */
export function shapePersonalHome(raw: PersonalHomeRaw, now: Date): PersonalHomeData {
  const personal = raw.spaces.find((s) => s.space.kind === "PERSONAL")?.space ?? null;
  const timeZone = effectiveTimezone(raw.user, personal);
  const todayKey = localDateKey(now, timeZone);

  const clubs: PersonalHomeClub[] = [];
  const upcoming: UpcomingItem[] = [];
  const due: DueTask[] = [];
  const waiting: (WaitingPoll & { sortAt: number })[] = [];
  const ownPolls: OwnPoll[] = [];
  let hosting: HostedPage[] = [];

  for (const { space, digest } of raw.spaces) {
    const ref = refOf(space);
    const base = `/app/${space.slug}`;
    if (space.kind === "CLUB") {
      clubs.push({
        id: space.id,
        name: space.name,
        slug: space.slug,
        logo: space.logo,
        role: space.role,
        title: space.title,
        nextMeeting: digest?.nextMeeting ?? null,
        openTasks: digest?.openTasks ?? 0,
        unread: digest?.unread ?? 0,
        paused: isPaused(space, now),
        timeZone: space.timezone,
      });
    }
    if (!digest) continue;
    for (const e of digest.events) {
      upcoming.push({
        ...e,
        space: ref,
        rsvp: digest.rsvps.get(e.id) ?? null,
        href: `${base}/calendar/${e.id}`,
      });
    }
    for (const t of digest.dueTasks) {
      if (!t.dueDate) continue;
      const dueKey = dueKeyOf(t.dueDate);
      due.push({
        space: ref,
        id: t.id,
        title: t.title,
        status: t.status,
        dueKey,
        bucket: bucketOf(dueKey, todayKey),
        href: `${base}/tasks/${t.id}`,
      });
    }
    for (const p of digest.waitingAvailability) {
      waiting.push({
        space: ref,
        id: p.id,
        kind: "availability",
        title: p.title,
        closesAt: p.closesAt,
        href: pollHref(base, "availability", p.id),
        sortAt: p.closesAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
      });
    }
    for (const p of digest.waitingQuestions) {
      waiting.push({
        space: ref,
        id: p.id,
        kind: "question",
        title: p.question,
        closesAt: p.closesAt,
        href: `${base}/calendar/polls/${p.id}`,
        sortAt: p.closesAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
      });
    }
    for (const p of digest.ownPolls) {
      ownPolls.push({ space: ref, ...p, href: pollHref(base, "availability", p.id) });
    }
    if (space.kind === "PERSONAL") {
      hosting = digest.hosted.map((h) => ({
        id: h.id,
        title: h.title,
        startsAt: h.startsAt,
        endsAt: h.endsAt,
        allDay: h.allDay,
        enabled: h.rsvpEnabled,
        going: h.going,
        waitlist: h.waitlist,
        capacity: h.rsvpCapacity,
        manageHref: `${base}/calendar/${h.id}`,
        pageHref: h.rsvpEnabled && h.rsvpSlug ? `/e/${h.rsvpSlug}` : null,
      }));
    }
  }

  upcoming.sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title),
  );
  due.sort((a, b) => a.dueKey.localeCompare(b.dueKey) || a.title.localeCompare(b.title));
  waiting.sort((a, b) => a.sortAt - b.sortAt);

  const rsvps: RsvpTicket[] = raw.registrations
    .filter(
      (r): r is RegistrationRow & { status: RsvpTicket["status"] } =>
        r.status === "GOING" || r.status === "WAITLIST",
    )
    .map((r) => ({
      registrationId: r.registrationId,
      status: r.status,
      title: r.title,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      allDay: r.allDay,
      host: r.spaceKind === "CLUB" ? r.spaceName : null,
      timeZone: r.spaceTimezone,
      pageHref: `/e/${r.rsvpSlug}`,
      ticketHref: `/e/${r.rsvpSlug}/t/${r.ticketCode}`,
    }));

  const profileGaps = profileGapsOf(raw.user);
  const bySpace = raw.spaces
    .map(({ space, digest }) => ({ space: refOf(space), done: digest?.doneThisWeek ?? 0 }))
    .filter((s) => s.done > 0)
    .sort((a, b) => b.done - a.done);
  const personalDigest = raw.spaces.find((s) => s.space.kind === "PERSONAL");
  return {
    yourWeek: { done: bySpace.reduce((n, s) => n + s.done, 0), bySpace },
    recentFiles: (personalDigest?.digest?.recentFiles ?? []).map((f) => ({
      ...f,
      href: `/app/${personalDigest!.space.slug}/notes/files/${f.id}`,
    })),
    firstName: raw.user?.name?.trim().split(/\s+/)[0] || null,
    timeZone,
    todayKey,
    emailVerified: raw.user?.emailVerified ?? false,
    clubs,
    moreClubs: raw.moreClubs,
    pendingInvites: raw.pendingInvites,
    upcoming: upcoming.slice(0, UPCOMING_LIMIT),
    dueSoon: due.slice(0, DUE_SOON_LIMIT),
    dueSoonTotal: due.length,
    pollsWaiting: waiting.slice(0, POLLS_LIMIT).map(({ sortAt: _sortAt, ...p }) => p),
    ownPolls: ownPolls.slice(0, POLLS_LIMIT),
    rsvps,
    hosting,
    profileGaps,
    finishProfileHref: profileGaps[0] ? profileStepHref(profileGaps[0]) : null,
  };
}

/** The Personal dashboard for the session user (`userId`), once per request. */
export const loadPersonalHome = cache(async (userId: string): Promise<PersonalHomeData> => {
  const now = new Date();
  return shapePersonalHome(await readRaw(userId, now), now);
});
