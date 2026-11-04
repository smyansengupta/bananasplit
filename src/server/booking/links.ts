import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import {
  BOOKING_DURATIONS,
  DEFAULT_HOURS,
  readHours,
  readOverrides,
  type DateOverride,
  type WeeklyHours,
} from "@/lib/booking/hours";
import { bookingSlug, readQuestions, SLUG_RE, type BookingQuestion } from "@/lib/crm/outreach/booking";
import { MAX_REMINDER_MINUTES } from "@/lib/meetings/reminders";
import { isValidTimeZone } from "@/lib/tasks/dates";
import { randomToken } from "@/server/crm/outreach/tokens";
import type { MemberContext, TxClient } from "@/server/db/context";

import { bookingAccess } from "./access";

/**
 * Making and changing booking links (Meetings > Booking links;
 * docs/features/booking.md). Your own link is made the first time you open
 * the tab (every member of every space has one) and only you change it.
 * Organization links need the CRM (bookingAccess); anyone in the
 * organization can share them, and their hosts, whoever made them, owners,
 * admins and CRM managers change them.
 */

export class BookingLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingLinkError";
  }
}

export interface LinkInput {
  title?: string;
  description?: string | null;
  durationMin?: number;
  durations?: number[];
  bufferMin?: number;
  minNoticeHours?: number;
  maxDaysAhead?: number;
  maxPerDay?: number | null;
  timezone?: string | null;
  hours?: WeeklyHours | null;
  dateOverrides?: DateOverride[];
  hostIds?: string[];
  questions?: BookingQuestion[];
  pipelineId?: string | null;
  video?: boolean;
  location?: string | null;
  reminderMinutes?: number[];
  active?: boolean;
  slug?: string;
}

function suffix(): string {
  return randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x");
}

/** Your own link in this space, made on first use. */
export async function ensurePersonalLink(ctx: MemberContext): Promise<{ id: string; slug: string }> {
  const { db, organizationId, userId } = ctx;
  const found = await db.crmBookingPage.findFirst({
    where: { organizationId, ownerUserId: userId },
    select: { id: true, slug: true },
  });
  if (found) return found;
  const [user, org] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, timezone: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  const first = (user?.name ?? "").trim().split(/\s+/)[0] || "me";
  const zone = isValidTimeZone(user?.timezone) ? user!.timezone! : (org?.timezone ?? "UTC");
  try {
    return await db.crmBookingPage.create({
      data: {
        organizationId,
        ownerUserId: userId,
        slug: bookingSlug(user?.name ?? "meet", suffix()),
        title: `Meet with ${first}`,
        hostIds: [userId],
        hours: DEFAULT_HOURS as unknown as Prisma.InputJsonObject,
        timezone: zone,
        minNoticeHours: 12,
        maxDaysAhead: 30,
        questions: [{ id: "q1", label: "What would you like to talk about?", required: false }],
        // Off until you turn it on: a live link shows when you're free.
        active: false,
        createdById: userId,
      },
      select: { id: true, slug: true },
    });
  } catch {
    // Made by another tab at the same moment.
    const again = await db.crmBookingPage.findFirst({ where: { organizationId, ownerUserId: userId }, select: { id: true, slug: true } });
    if (!again) throw new BookingLinkError("Your booking link couldn't be made. Try again.");
    return again;
  }
}

export async function createOrgLink(ctx: MemberContext, title: string): Promise<{ id: string; slug: string }> {
  const { db, organizationId, userId } = ctx;
  const access = await bookingAccess(db, organizationId);
  if (!access.orgLinks) {
    throw new BookingLinkError(
      access.personal ? "A Personal space has your own link only." : "Organization links come with the CRM. Add it on Integrations and apps.",
    );
  }
  const t = title.trim().slice(0, 120);
  if (!t) throw new BookingLinkError("Give it a name.");
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return db.crmBookingPage.create({
    data: {
      organizationId,
      slug: bookingSlug(t, suffix()),
      title: t,
      hostIds: [userId],
      hours: DEFAULT_HOURS as unknown as Prisma.InputJsonObject,
      timezone: org?.timezone ?? "UTC",
      questions: [{ id: "q1", label: "What would you like to talk about?", required: false }],
      createdById: userId,
    },
    select: { id: true, slug: true },
  });
}

/** Who may change a link: its owner (personal), or (organization) its hosts, its maker, admins and CRM managers. */
export async function canEditLink(
  ctx: MemberContext,
  page: { ownerUserId: string | null; hostIds: string[]; createdById: string | null },
): Promise<boolean> {
  if (page.ownerUserId) return page.ownerUserId === ctx.userId;
  if (page.hostIds.includes(ctx.userId) || page.createdById === ctx.userId) return true;
  return runsLinks(ctx);
}

/** Owners, admins and CRM managers: they may put anyone on an organization link. */
async function runsLinks(ctx: MemberContext): Promise<boolean> {
  if (can(ctx, "settings.general.write")) return true;
  const s = await ctx.db.crmSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { managerIds: true } });
  return Boolean(s?.managerIds.includes(ctx.userId));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Math.round(n), lo), hi);

export async function updateLink(ctx: MemberContext, id: string, input: LinkInput): Promise<void> {
  const { db, organizationId } = ctx;
  const page = await db.crmBookingPage.findFirst({
    where: { id, organizationId },
    select: { id: true, ownerUserId: true, hostIds: true, createdById: true },
  });
  if (!page) throw new BookingLinkError("That booking link isn't here any more.");
  if (!(await canEditLink(ctx, page))) throw new BookingLinkError("Only its hosts and whoever runs the CRM can change this link.");
  const data: Prisma.CrmBookingPageUpdateInput = {};
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, 120);
    if (!t) throw new BookingLinkError("Give it a name.");
    data.title = t;
  }
  if (input.description !== undefined) data.description = input.description?.trim().slice(0, 2000) || null;
  const allowed = BOOKING_DURATIONS as readonly number[];
  if (input.durationMin !== undefined) {
    if (!allowed.includes(input.durationMin)) throw new BookingLinkError("Pick how long.");
    data.durationMin = input.durationMin;
  }
  if (input.durations !== undefined) data.durations = [...new Set(input.durations.filter((d) => allowed.includes(d)))].slice(0, 3);
  if (input.bufferMin !== undefined) data.bufferMin = clamp(input.bufferMin, 0, 120);
  if (input.minNoticeHours !== undefined) data.minNoticeHours = clamp(input.minNoticeHours, 0, 336);
  if (input.maxDaysAhead !== undefined) data.maxDaysAhead = clamp(input.maxDaysAhead, 1, 90);
  if (input.maxPerDay !== undefined) data.maxPerDay = input.maxPerDay ? clamp(input.maxPerDay, 1, 24) : null;
  if (input.timezone !== undefined) {
    if (input.timezone && !isValidTimeZone(input.timezone)) throw new BookingLinkError("Pick a time zone.");
    data.timezone = input.timezone || null;
  }
  if (input.hours !== undefined) {
    // A personal link always has hours ("the times you're free"); an organization link may use its hosts' availability.
    const h = input.hours ? readHours(input.hours) : null;
    if (!h && page.ownerUserId) throw new BookingLinkError("Fill in when you're free.");
    data.hours = h ? (h as unknown as Prisma.InputJsonObject) : Prisma.DbNull;
  }
  if (input.dateOverrides !== undefined) {
    data.dateOverrides = readOverrides(input.dateOverrides) as unknown as Prisma.InputJsonArray;
  }
  if (input.questions !== undefined) data.questions = readQuestions(input.questions) as unknown as Prisma.InputJsonArray;
  if (input.video !== undefined) data.video = input.video;
  if (input.location !== undefined) data.location = input.location?.trim().slice(0, 300) || null;
  if (input.reminderMinutes !== undefined) {
    data.reminderMinutes = [...new Set(input.reminderMinutes.map((m) => Math.round(m)).filter((m) => m >= 1 && m <= MAX_REMINDER_MINUTES))]
      .sort((a, b) => b - a)
      .slice(0, 4);
  }
  if (input.active !== undefined) data.active = input.active;
  if (!page.ownerUserId) {
    if (input.hostIds) {
      const hosts = [...new Set(input.hostIds)].slice(0, 20);
      if (hosts.length === 0) throw new BookingLinkError("Someone has to host it.");
      const members = await db.membership.findMany({ where: { organizationId, userId: { in: hosts } }, select: { userId: true } });
      if (members.length !== hosts.length) throw new BookingLinkError("Hosts have to be in the organization.");
      // A public link shows its hosts' open times and books their calendars,
      // so only whoever runs the CRM puts someone else on one; anyone may add
      // or take off themselves.
      const added = hosts.filter((h) => h !== ctx.userId && !page.hostIds.includes(h));
      if (added.length && !(await runsLinks(ctx))) {
        throw new BookingLinkError("Only admins and CRM managers can add other people as hosts.");
      }
      data.hostIds = hosts;
    }
    if (input.pipelineId !== undefined) {
      if (input.pipelineId) {
        const p = await db.crmPipeline.findFirst({ where: { id: input.pipelineId, organizationId, archivedAt: null }, select: { id: true } });
        if (!p) throw new BookingLinkError("Pick a pipeline.");
      }
      data.pipelineId = input.pipelineId || null;
    }
  }
  if (input.slug !== undefined) {
    const s = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) throw new BookingLinkError("Use 3 to 48 lowercase letters, numbers and dashes.");
    const taken = await db.crmBookingPage.findFirst({ where: { slug: s, id: { not: id } }, select: { id: true } });
    if (taken) throw new BookingLinkError("That link is taken.");
    data.slug = s;
  }
  await db.crmBookingPage.update({ where: { id: page.id }, data });
}

/**
 * A member is leaving (in the removal's own transaction, as the remover):
 * their own link stops taking bookings, they come off organization links,
 * and a link left with nobody stops too. Their upcoming bookings are moved
 * to another host or flagged by the booking-host-left job.
 */
export async function bookingMemberLeft(db: TxClient, organizationId: string, userId: string): Promise<void> {
  await db.crmBookingPage.updateMany({ where: { organizationId, ownerUserId: userId }, data: { active: false } });
  const pages = await db.crmBookingPage.findMany({
    where: { organizationId, ownerUserId: null, hostIds: { has: userId } },
    select: { id: true, hostIds: true },
  });
  for (const p of pages) {
    const hosts = p.hostIds.filter((h) => h !== userId);
    await db.crmBookingPage.update({ where: { id: p.id }, data: { hostIds: hosts, ...(hosts.length ? {} : { active: false }) } });
  }
  const { enqueueJob } = await import("@/server/jobs/enqueue");
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "booking-host-left",
    key: `${userId}:${Date.now()}`,
    payload: { userId },
  });
}
