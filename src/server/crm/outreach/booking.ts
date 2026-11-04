import type { Prisma } from "@/generated/prisma/client";
import { bookingSlug, readQuestions, SLUG_RE, type BookingQuestion } from "@/lib/crm/outreach/booking";

import { CrmError, requireMember, type CrmActor } from "../access";
import { randomToken } from "./tokens";

/**
 * The CRM's older booking page actions (organization links). Booking links
 * are managed in Meetings > Booking links now (src/server/booking/links.ts;
 * docs/features/booking.md); these stay for the CRM's outreach actions
 * until those are retired.
 */

export interface BookingPageInput {
  title?: string;
  description?: string | null;
  durationMin?: number;
  bufferMin?: number;
  hostIds?: string[];
  questions?: BookingQuestion[];
  pipelineId?: string | null;
  minNoticeHours?: number;
  maxDaysAhead?: number;
  active?: boolean;
  slug?: string;
}

export async function createBookingPage(actor: CrmActor, title: string): Promise<{ id: string; slug: string }> {
  const t = title.trim().slice(0, 120) || "Meet with us";
  const slug = bookingSlug(t, randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x"));
  return actor.db.crmBookingPage.create({
    data: {
      organizationId: actor.organizationId,
      slug,
      title: t,
      hostIds: [actor.userId],
      questions: [{ id: "q1", label: "What would you like to talk about?", required: false }],
      createdById: actor.userId,
    },
    select: { id: true, slug: true },
  });
}

export async function updateBookingPage(actor: CrmActor, id: string, input: BookingPageInput): Promise<void> {
  const { db, organizationId } = actor;
  const page = await db.crmBookingPage.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!page) throw new CrmError("That booking page isn't here any more.");
  const data: Prisma.CrmBookingPageUpdateInput = {};
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, 120);
    if (!t) throw new CrmError("Give it a title.", ["title"]);
    data.title = t;
  }
  if (input.description !== undefined) data.description = input.description?.trim().slice(0, 2000) || null;
  if (input.durationMin !== undefined) {
    if (![15, 20, 30, 45, 60, 90].includes(input.durationMin)) throw new CrmError("Pick how long.");
    data.durationMin = input.durationMin;
  }
  if (input.bufferMin !== undefined) data.bufferMin = Math.min(Math.max(Math.round(input.bufferMin), 0), 60);
  if (input.minNoticeHours !== undefined) data.minNoticeHours = Math.min(Math.max(Math.round(input.minNoticeHours), 0), 168);
  if (input.maxDaysAhead !== undefined) data.maxDaysAhead = Math.min(Math.max(Math.round(input.maxDaysAhead), 1), 90);
  if (input.active !== undefined) data.active = input.active;
  if (input.hostIds) {
    const hosts = [...new Set(input.hostIds)].slice(0, 20);
    if (hosts.length === 0) throw new CrmError("Someone has to host it.");
    for (const h of hosts) await requireMember(db, organizationId, h);
    data.hostIds = hosts;
  }
  if (input.questions) data.questions = readQuestions(input.questions) as unknown as Prisma.InputJsonArray;
  if (input.pipelineId !== undefined) {
    if (input.pipelineId) {
      const p = await db.crmPipeline.findFirst({ where: { id: input.pipelineId, organizationId, archivedAt: null }, select: { id: true } });
      if (!p) throw new CrmError("Pick a pipeline.");
    }
    data.pipelineId = input.pipelineId || null;
  }
  if (input.slug !== undefined) {
    const s = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) throw new CrmError("Use 3 to 48 lowercase letters, numbers and dashes.", ["slug"]);
    const taken = await db.crmBookingPage.findFirst({ where: { slug: s, id: { not: id } }, select: { id: true } });
    if (taken) throw new CrmError("That link is taken.", ["slug"]);
    data.slug = s;
  }
  await db.crmBookingPage.update({ where: { id: page.id }, data });
}

// ---- The public page ---------------------------------------------------------------

// Booking (the public page, the guest's link, the calendar and the Inbox)
// lives in src/server/booking now (docs/features/booking.md); these names
// stay for older imports.
export { book, loadBooking, type BookInput, type BookResult, type PublicBooking } from "@/server/booking/book";
