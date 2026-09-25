"use server";

import { z } from "zod";

import { EventVisibility, PollAvailability } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/permissions";
import { isValidTimeZone } from "@/lib/calendar/dates";
import { pollSlots } from "@/lib/calendar/poll-slots";
import { withOrgAction } from "@/server/db/context";
import * as events from "@/server/events/service";

import { actionError } from "../action-result";

/**
 * Availability polls, on the member path (withOrgAction, app_user under
 * RLS). Any member creates a poll; its creator or an OWNER/ADMIN deletes it.
 * Finalizing creates an event through the event service, so it is ADMIN+
 * like every other event write; the event is INTERNAL (a meeting time, not
 * a public session) and only current members who answered yes or if-needed
 * become attendees (0A Fix 6).
 */

const createPollSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(2000).nullable().optional(),
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Unknown timezone"),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1, "Pick at least one date")
    .max(31),
  dailyStartMinutes: z.number().int().min(0).max(1440),
  dailyEndMinutes: z.number().int().min(0).max(1440),
  granularityMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  durationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60),
  closesAt: z.string().nullable().optional(),
});

interface ActionResult {
  error?: string;
  pollId?: string;
}

const createPollTx = withOrgAction(async (ctx, input: unknown): Promise<ActionResult> => {
  const parsed = createPollSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;
  if (data.dailyEndMinutes <= data.dailyStartMinutes) {
    return { error: "The daily window's end must be after its start." };
  }
  const slots = pollSlots(data);
  if (slots.length === 0)
    return { error: "That daily window doesn't fit any slots at this granularity." };
  if (slots.length > 2000)
    return { error: "That is too many slots. Pick fewer dates or a coarser grid." };
  const closesAt = data.closesAt ? new Date(data.closesAt) : null;
  if (closesAt && Number.isNaN(closesAt.getTime())) return { error: "Enter a valid closing time." };

  const poll = await ctx.db.availabilityPoll.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description ?? null,
      timezone: data.timezone,
      durationMinutes: data.durationMinutes,
      closesAt,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await ctx.db.pollSlot.createMany({
    data: slots.map((s) => ({ ...s, organizationId: ctx.organizationId, pollId: poll.id })),
  });
  return { pollId: poll.id };
});

export async function createPoll(organizationId: string, input: unknown): Promise<ActionResult> {
  try {
    return await createPollTx(organizationId, input);
  } catch (error) {
    return actionError(error);
  }
}

const deletePollTx = withOrgAction(async (ctx, pollId: string): Promise<ActionResult> => {
  const poll = await ctx.db.availabilityPoll.findFirst({
    where: { id: pollId, organizationId: ctx.organizationId },
    select: { id: true, createdById: true },
  });
  if (!poll) return { error: "Poll not found." };
  if (poll.createdById !== ctx.userId && !can(ctx, "events.write")) {
    return { error: "You don't have permission to delete this poll." };
  }
  await ctx.db.availabilityPoll.delete({ where: { id: poll.id } });
  return {};
});

export async function deletePoll(organizationId: string, pollId: string): Promise<ActionResult> {
  try {
    return await deletePollTx(organizationId, pollId);
  } catch (error) {
    return actionError(error);
  }
}

interface FinalizeResult extends ActionResult {
  eventId?: string;
  excludedGuestCount?: number;
}

const finalizePollTx = withOrgAction(
  async (ctx, pollId: string, slotId: string): Promise<FinalizeResult> => {
    requirePermission(ctx, "events.write");
    const poll = await ctx.db.availabilityPoll.findFirst({
      where: { id: pollId, organizationId: ctx.organizationId },
      select: {
        id: true,
        title: true,
        description: true,
        durationMinutes: true,
        closesAt: true,
        finalizedEventId: true,
        slots: { select: { id: true, startsAt: true } },
        responses: {
          select: { id: true, slotId: true, userId: true, guestKeyHash: true, availability: true },
        },
      },
    });
    if (!poll) return { error: "Poll not found." };
    if (poll.finalizedEventId) return { error: "This poll has already been finalized." };
    const slot = poll.slots.find((s) => s.id === slotId);
    if (!slot) return { error: "That slot isn't part of this poll." };

    const respondents = poll.responses.filter(
      (r) =>
        r.slotId === slotId &&
        (r.availability === PollAvailability.YES || r.availability === PollAvailability.IF_NEEDED),
    );
    // Only CURRENT members of this org become attendees (0A Fix 6).
    const respondentUserIds = [
      ...new Set(respondents.flatMap((r) => (r.userId ? [r.userId] : []))),
    ];
    const members = respondentUserIds.length
      ? await ctx.db.membership.findMany({
          where: { organizationId: ctx.organizationId, userId: { in: respondentUserIds } },
          select: { userId: true },
        })
      : [];
    const memberIds = new Set(members.map((m) => m.userId));
    const attendeeIds = respondentUserIds.filter((id) => memberIds.has(id));
    const guests = new Set(respondents.filter((r) => !r.userId).map((r) => r.guestKeyHash ?? r.id));
    const excludedGuestCount = guests.size + (respondentUserIds.length - attendeeIds.length);

    const { event } = await events.createEvent(ctx, {
      title: poll.title,
      description: poll.description,
      startsAt: slot.startsAt,
      endsAt: new Date(slot.startsAt.getTime() + poll.durationMinutes * 60_000),
      visibility: EventVisibility.INTERNAL,
    });
    if (attendeeIds.length > 0) {
      await ctx.db.eventAttendee.createMany({
        data: attendeeIds.map((userId) => ({
          organizationId: ctx.organizationId,
          eventId: event.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }
    await ctx.db.availabilityPoll.update({
      where: { id: poll.id },
      data: { finalizedEventId: event.id, closesAt: poll.closesAt ?? new Date() },
    });
    return { eventId: event.id, excludedGuestCount };
  },
);

/** Turns the chosen slot into an INTERNAL event with the members who can make it (ADMIN+). */
export async function finalizePoll(
  organizationId: string,
  pollId: string,
  slotId: string,
): Promise<FinalizeResult> {
  try {
    return await finalizePollTx(organizationId, pollId, slotId);
  } catch (error) {
    return actionError(error);
  }
}
