"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { PollAvailability } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const RESPONSE_RATE_LIMIT = 30;
const RESPONSE_RATE_WINDOW_MS = 60 * 1000;

async function clientIp(): Promise<string> {
  const headerList = await headers();
  return headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const AVAILABILITY_VALUES = Object.values(PollAvailability) as [
  PollAvailability,
  ...PollAvailability[],
];

const submitSchema = z.object({
  pollId: z.string(),
  guestName: z.string().trim().max(100).nullable().optional(),
  entries: z
    .array(z.object({ slotId: z.string(), availability: z.enum(AVAILABILITY_VALUES) }))
    .max(2000),
});

interface ActionResult {
  error?: string;
}

/**
 * No org-context guard: this is reachable by guests via the poll's shareable
 * link, per spec 4.4. Members are identified by session; guests must supply
 * a name, which stands in for an account (see the delete-then-recreate below
 * — there's no durable identity to upsert against for a guest).
 */
export async function submitPollResponse(input: unknown): Promise<ActionResult> {
  const rateLimit = checkRateLimit(
    `poll-response:${await clientIp()}`,
    RESPONSE_RATE_LIMIT,
    RESPONSE_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many responses submitted recently. Wait a moment and try again." };
  }

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const poll = await prisma.availabilityPoll.findUnique({
    where: { id: data.pollId },
    select: { id: true, finalizedEventId: true, closesAt: true, slots: { select: { id: true } } },
  });
  if (!poll) return { error: "Poll not found." };
  if (poll.finalizedEventId) return { error: "This poll has already been finalized." };
  if (poll.closesAt && poll.closesAt < new Date()) return { error: "This poll is closed." };

  const validSlotIds = new Set(poll.slots.map((s) => s.id));
  if (data.entries.some((e) => !validSlotIds.has(e.slotId))) {
    return { error: "That slot isn't part of this poll." };
  }

  const session = await getSession();

  if (session) {
    await prisma.$transaction(
      data.entries.map((e) =>
        prisma.pollResponse.upsert({
          where: { slotId_userId: { slotId: e.slotId, userId: session.user.id } },
          update: { availability: e.availability },
          create: {
            pollId: data.pollId,
            slotId: e.slotId,
            userId: session.user.id,
            availability: e.availability,
          },
        }),
      ),
    );
    return {};
  }

  const guestName = data.guestName?.trim();
  if (!guestName) {
    return { error: "Enter your name to respond." };
  }

  await prisma.$transaction([
    prisma.pollResponse.deleteMany({
      where: { pollId: data.pollId, userId: null, guestName },
    }),
    prisma.pollResponse.createMany({
      data: data.entries.map((e) => ({
        pollId: data.pollId,
        slotId: e.slotId,
        guestName,
        availability: e.availability,
      })),
    }),
  ]);
  return {};
}
