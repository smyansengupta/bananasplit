import { shortDayAt } from "@/components/calendar/day-label";
import type { ConferenceProvider } from "@/generated/prisma/enums";
import { bookingAmbient, confirmWaiting, linkAmbient, type BookingAmbient, type LinkAmbient } from "@/lib/ambient/booking";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import {
  DEFAULT_HOURS,
  minuteLabel,
  offeredDurations,
  readHours,
  readOverrides,
  type DateOverride,
  type WeeklyHours,
} from "@/lib/booking/hours";
import { comingWeek, hoursShort, lengthsLine, type WeekDay } from "@/lib/booking/week";
import { safeTimeZone } from "@/lib/calendar/dates";
import { readQuestions, wallClock, type BookingQuestion } from "@/lib/crm/outreach/booking";
import { CONFERENCE_LABELS } from "@/lib/meetings/conference-status";
import { until } from "@/lib/relative-time";
import { timeLine } from "@/lib/rsvp/when";
import { withSystemOrgTx, type MemberContext } from "@/server/db/context";
import { userPublicSelect, type UserPublic } from "@/server/members";

import { bookingAccess, mainLinkId, type BookingAccess } from "./access";
import { askKey, canEditLink, ensureMainLink, ensurePersonalLink } from "./links";
import { pageTimeZone, slotsFor } from "./slots";

/** Meetings > Meeting links' data (src/app/app/[orgSlug]/meetings/booking/page.tsx). */

/** The most links whose open times are worked out on one page load (each reads a calendar). */
const OPEN_TIMES_FOR = 20;

export interface BookingLinkState {
  id: string;
  personal: boolean;
  /** The organization's own link (mainLinkId). */
  main: boolean;
  title: string;
  description: string;
  slug: string;
  url: string;
  durationMin: number;
  durations: number[];
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  maxPerDay: number | null;
  timezone: string;
  /** null: the hosts' availability (organization links only). */
  hours: WeeklyHours | null;
  dateOverrides: DateOverride[];
  hostIds: string[];
  questions: BookingQuestion[];
  pipelineId: string | null;
  video: boolean;
  location: string;
  reminderMinutes: number[];
  active: boolean;
  canEdit: boolean;
  /** Open times in the next two weeks (0 warns that nobody can book it); null when not worked out. */
  openSoon: number | null;
  booked: number;
  /** "Tomorrow 9 AM", in the link's own zone, as its hours are. */
  nextOpen: string | null;
  /** The next seven days as a picture; null when it reads the hosts' availability. */
  week: WeekDay[] | null;
  /** The hours in a few words. */
  hoursLine: string;
  /** "30 or 60 minutes". */
  lengths: string;
  ambient: LinkAmbient[];
}

/** Someone in the organization, as other members may see them. */
export interface BookingMember extends UserPublic {
  name: string;
  title: string | null;
}

/**
 * One card in the grid. `link` is only there while it's on: a link that's
 * off shows when you're free to nobody, so nothing of it reaches anyone
 * else's browser. Your own card reads `mine`.
 */
export interface BookingPerson extends BookingMember {
  me: boolean;
  link: Pick<BookingLinkState, "url" | "title" | "week" | "hoursLine" | "lengths" | "openSoon" | "nextOpen"> | null;
  /** Someone has already asked them to turn it on. */
  asked: boolean;
}

/** A booking as Coming up draws it. The guest's email and answers stay on the meeting's page. */
export interface BookingRow {
  id: string;
  eventId: string;
  guestName: string;
  startsAt: Date;
  /** "Tomorrow, 2:00 – 2:30 PM EST", in the organization's zone. */
  when: string;
  /** "in 2 hours". */
  soon: string;
  linkTitle: string;
  host: Pick<BookingMember, "name" | "image" | "avatar">;
  /** The call's name or the place, when it has one. */
  place: { online: boolean; label: string } | null;
  joinUrl: string | null;
  verified: boolean;
  /** Why it says unconfirmed. */
  waiting: string | null;
  needsHost: boolean;
  mine: boolean;
  ambient: BookingAmbient[];
}

export interface BookingLinksData {
  access: BookingAccess;
  mine: BookingLinkState;
  /** The organization's own link; null in a Personal space, and until someone who runs links opens the tab. */
  main: BookingLinkState | null;
  /** More organization links (with the CRM). */
  org: BookingLinkState[];
  /** Everyone's links, yours first, then those that are on. Empty in a Personal space. */
  people: BookingPerson[];
  members: BookingMember[];
  upcoming: BookingRow[];
  isAdmin: boolean;
}

type PageRow = Awaited<ReturnType<MemberContext["db"]["crmBookingPage"]["findFirstOrThrow"]>>;

function placeOf(e: { conferenceProvider: ConferenceProvider; location: string | null } | undefined) {
  if (!e) return null;
  if (e.conferenceProvider !== "NONE") return { online: true, label: CONFERENCE_LABELS[e.conferenceProvider] };
  const location = e.location?.trim();
  return location ? { online: false, label: location } : null;
}

export async function loadBookingLinks(ctx: MemberContext, now: Date = new Date()): Promise<BookingLinksData> {
  const { db, organizationId, userId } = ctx;
  const access = await bookingAccess(db, organizationId, now);
  const own = await ensurePersonalLink(ctx);
  const mainId = mainLinkId(organizationId);
  if (!access.personal) await ensureMainLink(ctx);
  const isAdmin = can(ctx, "settings.general.write");
  const pages = await db.crmBookingPage.findMany({
    where: { organizationId, OR: [{ id: own.id }, { id: mainId }, ...(access.orgLinks ? [{ ownerUserId: null }] : [])] },
    orderBy: { createdAt: "asc" },
    take: 60,
  });
  const memberRows = await db.membership.findMany({
    where: { organizationId },
    select: { title: true, user: { select: userPublicSelect } },
    take: 2000,
  });
  const members: BookingMember[] = memberRows
    .map((m) => ({ ...m.user, name: m.user.name ?? "Member", title: m.title }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const memberOf = new Map(members.map((m) => [m.id, m]));
  // Everyone else's link, for the grid. Every member can read a space's
  // links; only the ones that are on go any further than this function.
  const theirs = access.personal
    ? []
    : await db.crmBookingPage.findMany({
        where: {
          organizationId,
          active: true,
          ownerUserId: { in: members.map((m) => m.id).filter((m) => m !== userId) },
        },
        take: 2000,
      });
  const upcomingRows = await db.booking.findMany({
    where: { organizationId, status: "BOOKED", endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    take: 100,
    select: {
      id: true,
      eventId: true,
      guestName: true,
      startsAt: true,
      endsAt: true,
      hostUserId: true,
      verifiedAt: true,
      needsHost: true,
      page: { select: { title: true } },
    },
  });
  // Never the host's start link: Join is the guest's link.
  const events = await db.event.findMany({
    where: { organizationId, id: { in: upcomingRows.map((b) => b.eventId) }, deletedAt: null },
    select: { id: true, conferenceUrl: true, conferenceProvider: true, location: true },
  });
  // The service path, for three things a member can't read for themselves,
  // none of them about a guest: how many bookings each link has (members
  // read only the ones they host), open times (the hosts' calendars in every
  // space, times only), and who was already asked (other people's Inbox).
  const open = new Map<string, { count: number; next: Date | null }>();
  const asked = new Set<string>();
  const counts = await withSystemOrgTx(organizationId, async ({ db: sdb }) => {
    const rank = (p: PageRow) => (p.id === own.id ? 0 : p.id === mainId ? 1 : 2);
    const ownFirst = [...pages].sort((a, b) => rank(a) - rank(b));
    for (const p of [...ownFirst, ...theirs].filter((x) => x.active).slice(0, OPEN_TIMES_FOR)) {
      const tz = pageTimeZone(p, access.timezone);
      const soon = await slotsFor(sdb, { ...p, maxDaysAhead: Math.min(p.maxDaysAhead, 14) }, tz, now, {
        durationMin: p.durationMin,
      });
      open.set(p.id, { count: soon.length, next: soon[0]?.start ?? null });
    }
    if (!access.personal) {
      const on = new Set(theirs.map((p) => p.ownerUserId));
      const off = members.filter((m) => m.id !== userId && !on.has(m.id));
      const notes = await sdb.notification.findMany({
        where: { organizationId, dedupeKey: { in: off.map((m) => `booking:${askKey(organizationId, m.id)}`) } },
        select: { userId: true },
      });
      for (const n of notes) asked.add(n.userId);
    }
    return sdb.booking.groupBy({
      by: ["pageId"],
      where: { organizationId, pageId: { in: pages.map((p) => p.id) }, status: "BOOKED" },
      _count: { _all: true },
    });
  });
  const zone = safeTimeZone(access.timezone);
  /** What a card or a strip shows of a link, for anyone who may see it. */
  const shown = (p: PageRow) => {
    const tz = pageTimeZone(p, zone);
    const hours = readHours(p.hours) ?? (p.ownerUserId ? DEFAULT_HOURS : null);
    const next = open.get(p.id)?.next ?? null;
    return {
      url: appUrl(`/book/${p.slug}`),
      title: p.title,
      week: hours ? comingWeek(hours, readOverrides(p.dateOverrides), tz, now) : null,
      hoursLine: hours ? hoursShort(hours) : "Each host's own hours",
      lengths: lengthsLine(offeredDurations(p.durationMin, p.durations)),
      openSoon: open.get(p.id)?.count ?? null,
      nextOpen: next ? `${shortDayAt(next, tz, now)} ${minuteLabel(wallClock(next, tz).min)}` : null,
    };
  };
  const state = async (p: PageRow): Promise<BookingLinkState> => {
    const canEdit = await canEditLink(ctx, p);
    const booked = counts.find((c) => c.pageId === p.id)?._count._all ?? 0;
    const facts = shown(p);
    return {
      ...facts,
      id: p.id,
      personal: Boolean(p.ownerUserId),
      main: p.id === mainId,
      description: p.description ?? "",
      slug: p.slug,
      durationMin: p.durationMin,
      durations: offeredDurations(p.durationMin, p.durations).slice(1),
      bufferMin: p.bufferMin,
      minNoticeHours: p.minNoticeHours,
      maxDaysAhead: p.maxDaysAhead,
      maxPerDay: p.maxPerDay,
      timezone: pageTimeZone(p, zone),
      hours: readHours(p.hours) ?? (p.ownerUserId ? DEFAULT_HOURS : null),
      dateOverrides: readOverrides(p.dateOverrides),
      hostIds: p.hostIds,
      questions: readQuestions(p.questions),
      pipelineId: p.pipelineId,
      video: p.video,
      location: p.location ?? "",
      reminderMinutes: p.reminderMinutes ?? [],
      active: p.active,
      canEdit,
      booked,
      ambient: linkAmbient({
        personal: Boolean(p.ownerUserId),
        active: p.active,
        canEdit,
        hosts: p.hostIds.length,
      }),
    };
  };
  const mine = await state(pages.find((p) => p.id === own.id)!);
  const mainPage = pages.find((p) => p.id === mainId);
  const main = mainPage ? await state(mainPage) : null;
  const org = [];
  for (const p of pages) if (!p.ownerUserId && p.id !== mainId) org.push(await state(p));
  const linkOf = new Map(theirs.map((p) => [p.ownerUserId, p]));
  const people: BookingPerson[] = access.personal
    ? []
    : members
        .map((m) => {
          const page = linkOf.get(m.id);
          return { ...m, me: m.id === userId, link: page ? shown(page) : null, asked: asked.has(m.id) };
        })
        // You, then the links that are on, each by name (members are sorted already).
        .sort((a, b) => Number(b.me) - Number(a.me) || Number(Boolean(b.link)) - Number(Boolean(a.link)));
  const upcoming = upcomingRows.map((b): BookingRow => {
    const event = events.find((e) => e.id === b.eventId);
    const joinUrl = event?.conferenceUrl ?? null;
    return {
      id: b.id,
      eventId: b.eventId,
      guestName: b.guestName,
      startsAt: b.startsAt,
      when: `${shortDayAt(b.startsAt, zone, now)}, ${timeLine(b.startsAt, b.endsAt, zone)}`,
      soon: until(b.startsAt, now),
      linkTitle: b.page.title,
      host: memberOf.get(b.hostUserId) ?? { name: "A former member", image: null, avatar: null },
      place: placeOf(event),
      joinUrl,
      verified: Boolean(b.verifiedAt),
      waiting: b.verifiedAt ? null : confirmWaiting(b.guestName),
      needsHost: b.needsHost,
      mine: b.hostUserId === userId,
      ambient: bookingAmbient(
        { startsAt: b.startsAt, endsAt: b.endsAt, joinUrl, needsHost: b.needsHost, canTake: isAdmin },
        now,
      ),
    };
  });
  return {
    access,
    mine,
    main,
    org,
    people,
    members,
    // What needs someone comes first; the rest stay in time order.
    upcoming: [...upcoming].sort((a, b) => Number(b.needsHost && isAdmin) - Number(a.needsHost && isAdmin)),
    isAdmin,
  };
}
