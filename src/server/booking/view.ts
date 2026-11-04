import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import {
  DEFAULT_HOURS,
  offeredDurations,
  readHours,
  readOverrides,
  type DateOverride,
  type WeeklyHours,
} from "@/lib/booking/hours";
import { readQuestions, type BookingQuestion } from "@/lib/crm/outreach/booking";
import { withSystemOrgTx, type MemberContext } from "@/server/db/context";

import { bookingAccess, type BookingAccess } from "./access";
import { canEditLink, ensurePersonalLink } from "./links";
import { pageTimeZone, slotsFor } from "./slots";

/** Meetings > Booking links' data (src/app/app/[orgSlug]/meetings/booking/page.tsx). */

export interface BookingLinkState {
  id: string;
  personal: boolean;
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
  /** Open times in the next two weeks (0 warns that nobody can book it). */
  openSoon: number;
  booked: number;
}

export interface BookingRow {
  id: string;
  eventId: string;
  guestName: string;
  guestEmail: string;
  startsAt: Date;
  endsAt: Date;
  linkTitle: string;
  hostId: string;
  hostName: string;
  verified: boolean;
  needsHost: boolean;
  mine: boolean;
}

export interface BookingLinksData {
  access: BookingAccess;
  mine: BookingLinkState;
  org: BookingLinkState[];
  upcoming: BookingRow[];
  isAdmin: boolean;
}

type PageRow = Awaited<ReturnType<MemberContext["db"]["crmBookingPage"]["findFirstOrThrow"]>>;

export async function loadBookingLinks(ctx: MemberContext, now: Date = new Date()): Promise<BookingLinksData> {
  const { db, organizationId, userId } = ctx;
  const access = await bookingAccess(db, organizationId, now);
  const own = await ensurePersonalLink(ctx);
  const pages = await db.crmBookingPage.findMany({
    where: { organizationId, OR: [{ id: own.id }, ...(access.orgLinks ? [{ ownerUserId: null }] : [])] },
    orderBy: { createdAt: "asc" },
    take: 60,
  });
  const upcomingRows = await db.booking.findMany({
    where: { organizationId, status: "BOOKED", endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    take: 100,
    select: {
      id: true,
      eventId: true,
      guestName: true,
      guestEmail: true,
      startsAt: true,
      endsAt: true,
      hostUserId: true,
      verifiedAt: true,
      needsHost: true,
      page: { select: { title: true } },
    },
  });
  const counts = await db.booking.groupBy({
    by: ["pageId"],
    where: { organizationId, pageId: { in: pages.map((p) => p.id) }, status: "BOOKED" },
    _count: { _all: true },
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(upcomingRows.map((b) => b.hostUserId))] } },
    select: { id: true, name: true },
  });
  // Open times need the hosts' calendars in every space (service path, times only).
  const open = new Map<string, number>();
  await withSystemOrgTx(organizationId, async ({ db: sdb }) => {
    for (const p of pages.slice(0, 20)) {
      if (!p.active) continue;
      const tz = pageTimeZone(p, access.timezone);
      const soon = await slotsFor(sdb, { ...p, maxDaysAhead: Math.min(p.maxDaysAhead, 14) }, tz, now, { durationMin: p.durationMin });
      open.set(p.id, soon.length);
    }
  });
  const state = async (p: PageRow): Promise<BookingLinkState> => ({
    id: p.id,
    personal: Boolean(p.ownerUserId),
    title: p.title,
    description: p.description ?? "",
    slug: p.slug,
    url: appUrl(`/book/${p.slug}`),
    durationMin: p.durationMin,
    durations: offeredDurations(p.durationMin, p.durations).slice(1),
    bufferMin: p.bufferMin,
    minNoticeHours: p.minNoticeHours,
    maxDaysAhead: p.maxDaysAhead,
    maxPerDay: p.maxPerDay,
    timezone: pageTimeZone(p, access.timezone),
    hours: readHours(p.hours) ?? (p.ownerUserId ? DEFAULT_HOURS : null),
    dateOverrides: readOverrides(p.dateOverrides),
    hostIds: p.hostIds,
    questions: readQuestions(p.questions),
    pipelineId: p.pipelineId,
    video: p.video,
    location: p.location ?? "",
    reminderMinutes: p.reminderMinutes ?? [],
    active: p.active,
    canEdit: await canEditLink(ctx, p),
    openSoon: open.get(p.id) ?? 0,
    booked: counts.find((c) => c.pageId === p.id)?._count._all ?? 0,
  });
  const mineRow = pages.find((p) => p.id === own.id)!;
  const org = [];
  for (const p of pages) if (!p.ownerUserId) org.push(await state(p));
  return {
    access,
    mine: await state(mineRow),
    org,
    upcoming: upcomingRows.map((b) => ({
      id: b.id,
      eventId: b.eventId,
      guestName: b.guestName,
      guestEmail: b.guestEmail,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      linkTitle: b.page.title,
      hostId: b.hostUserId,
      hostName: users.find((u) => u.id === b.hostUserId)?.name ?? "A former member",
      verified: Boolean(b.verifiedAt),
      needsHost: b.needsHost,
      mine: b.hostUserId === userId,
    })),
    isAdmin: can(ctx, "settings.general.write"),
  };
}
