"use server";

import { z } from "zod";

import { BookingLinkError, createOrgLink, updateLink } from "@/server/booking/links";
import { BookingActionError, hostCancel, takeBooking } from "@/server/booking/manage";
import { withOrgAction } from "@/server/db/context";

/**
 * Meetings > Booking links (docs/features/booking.md): change your link or
 * an organization link, make an organization link, cancel a booking or take
 * one whose host left. Every one runs as the session member; the server
 * module checks who may (your link is yours alone).
 */

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof BookingLinkError || error instanceof BookingActionError) return { ok: false, error: error.message };
  throw error;
}

const range = z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]);
const day = z.array(range).max(8);
const linkInput = z
  .object({
    title: z.string().max(200),
    description: z.string().max(2000).nullable(),
    durationMin: z.number().int(),
    durations: z.array(z.number().int()).max(6),
    bufferMin: z.number().int().min(0).max(240),
    minNoticeHours: z.number().int().min(0).max(1000),
    maxDaysAhead: z.number().int().min(1).max(365),
    maxPerDay: z.number().int().min(1).max(50).nullable(),
    timezone: z.string().max(64).nullable(),
    hours: z.object({ 1: day, 2: day, 3: day, 4: day, 5: day, 6: day, 7: day }).nullable(),
    dateOverrides: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ranges: z.array(range).max(8) })).max(120),
    hostIds: z.array(z.string().max(100)).max(20),
    questions: z.array(z.object({ id: z.string().max(40), label: z.string().max(200), required: z.boolean() })).max(10),
    pipelineId: z.string().max(100).nullable(),
    video: z.boolean(),
    location: z.string().max(300).nullable(),
    reminderMinutes: z.array(z.number().int()).max(6),
    active: z.boolean(),
    slug: z.string().max(60),
  })
  .partial();

export const saveBookingLinkAction = withOrgAction(async (ctx, id: string, raw: unknown): Promise<ActionResult> => {
  const parsed = linkInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Something's off. Check the times and try again." };
  try {
    await updateLink(ctx, id, parsed.data);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});

export const createOrgLinkAction = withOrgAction(
  async (ctx, title: string): Promise<ActionResult<{ id: string }>> => {
    try {
      const { id } = await createOrgLink(ctx, z.string().max(200).parse(title));
      return { ok: true, id };
    } catch (error) {
      return fail(error);
    }
  },
);

export const cancelBookingByHostAction = withOrgAction(
  async (ctx, bookingId: string, note: string): Promise<ActionResult> => {
    try {
      await hostCancel(ctx, z.string().max(100).parse(bookingId), z.string().max(500).catch("").parse(note));
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  },
);

export const takeBookingAction = withOrgAction(async (ctx, bookingId: string): Promise<ActionResult> => {
  try {
    await takeBooking(ctx, z.string().max(100).parse(bookingId));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});
