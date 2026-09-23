"use server";

import { TZDate } from "@date-fns/tz";
import { z } from "zod";

import { PollAvailability, Role } from "@/generated/prisma/client";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { prisma } from "@/lib/prisma";

const createPollSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(2000).nullable().optional(),
  timezone: z.string().min(1),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1, "Pick at least one date"),
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

export const createPoll = withOrgContext(async (ctx, input: unknown): Promise<ActionResult> => {
  const parsed = createPollSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  if (data.dailyEndMinutes <= data.dailyStartMinutes) {
    return { error: "The daily window's end must be after its start." };
  }

  const slots: { startsAt: Date; endsAt: Date }[] = [];
  for (const dateStr of data.dates) {
    const [year, month, day] = dateStr.split("-").map(Number);
    let cursor = data.dailyStartMinutes;
    while (cursor + data.granularityMinutes <= data.dailyEndMinutes) {
      const startsAt = TZDate.tz(
        data.timezone,
        year,
        month - 1,
        day,
        Math.floor(cursor / 60),
        cursor % 60,
      );
      const endsAt = new Date(startsAt.getTime() + data.granularityMinutes * 60_000);
      slots.push({ startsAt: new Date(startsAt), endsAt });
      cursor += data.granularityMinutes;
    }
  }

  if (slots.length === 0) {
    return { error: "That daily window doesn't fit any slots at this granularity." };
  }

  const poll = await prisma.availabilityPoll.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description ?? null,
      timezone: data.timezone,
      durationMinutes: data.durationMinutes,
      closesAt: data.closesAt ? new Date(data.closesAt) : null,
      createdById: ctx.user.id,
      slots: { create: slots },
    },
  });

  return { pollId: poll.id };
});

export const deletePoll = withOrgContext(async (ctx, pollId: string): Promise<ActionResult> => {
  const poll = await prisma.availabilityPoll.findFirst({
    where: { id: pollId, organizationId: ctx.organizationId },
  });
  if (!poll) return { error: "Poll not found." };
  if (poll.createdById !== ctx.user.id && ctx.role !== Role.OWNER && ctx.role !== Role.ADMIN) {
    return { error: "You don't have permission to delete this poll." };
  }
  await prisma.availabilityPoll.delete({ where: { id: pollId } });
  return {};
});

interface FinalizeResult extends ActionResult {
  eventId?: string;
  excludedGuestCount?: number;
}

export const finalizePoll = withOrgContext(
  async (ctx, pollId: string, slotId: string): Promise<FinalizeResult> => {
    const poll = await prisma.availabilityPoll.findFirst({
      where: { id: pollId, organizationId: ctx.organizationId },
      include: { slots: true, responses: true },
    });
    if (!poll) return { error: "Poll not found." };
    if (poll.finalizedEventId) return { error: "This poll has already been finalized." };
    if (poll.createdById !== ctx.user.id && ctx.role !== Role.OWNER && ctx.role !== Role.ADMIN) {
      return { error: "You don't have permission to finalize this poll." };
    }

    const slot = poll.slots.find((s) => s.id === slotId);
    if (!slot) return { error: "That slot isn't part of this poll." };

    const respondents = poll.responses.filter(
      (r) =>
        r.slotId === slotId &&
        (r.availability === PollAvailability.YES || r.availability === PollAvailability.IF_NEEDED),
    );
    // 0A Fix 6: only CURRENT members of this org become attendees. Anyone can
    // answer through the public link, and a signed-in user from another org
    // (or a member who has since left) must never be attached to this org's
    // event. Guests and non-members are counted and reported instead.
    const respondentUserIds = [
      ...new Set(respondents.flatMap((r) => (r.userId ? [r.userId] : []))),
    ];
    const members = respondentUserIds.length
      ? await prisma.membership.findMany({
          where: { organizationId: ctx.organizationId, userId: { in: respondentUserIds } },
          select: { userId: true },
        })
      : [];
    const memberIds = new Set(members.map((m) => m.userId));
    const memberAttendeeIds = respondentUserIds.filter((id) => memberIds.has(id));
    const excludedGuests = new Set(
      respondents
        .filter((r) => !r.userId)
        .map((r) => r.guestKeyHash ?? r.id),
    );
    const excludedGuestCount =
      excludedGuests.size + (respondentUserIds.length - memberAttendeeIds.length);

    const endsAt = new Date(slot.startsAt.getTime() + poll.durationMinutes * 60_000);

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          organizationId: ctx.organizationId,
          title: poll.title,
          description: poll.description,
          startsAt: slot.startsAt,
          endsAt,
          createdById: ctx.user.id,
          attendees: memberAttendeeIds.length
            ? { create: memberAttendeeIds.map((userId) => ({ userId })) }
            : undefined,
        },
      });
      await tx.availabilityPoll.update({
        where: { id: pollId },
        data: { finalizedEventId: created.id, closesAt: poll.closesAt ?? new Date() },
      });
      return created;
    });

    return { eventId: event.id, excludedGuestCount };
  },
);
