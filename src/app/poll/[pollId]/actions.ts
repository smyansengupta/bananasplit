"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import { PollAvailability } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth/session";
import {
  generateGuestKey,
  GUEST_KEY_MAX_AGE_SECONDS,
  guestCookieName,
  guestCookiePath,
  hashGuestKey,
  isWellFormedGuestKey,
} from "@/lib/polls/guest-key";
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
  pollId: z.string().min(1),
  guestName: z.string().trim().max(100).nullable().optional(),
  entries: z
    .array(z.object({ slotId: z.string(), availability: z.enum(AVAILABILITY_VALUES) }))
    .max(2000),
});

interface ActionResult {
  error?: string;
}

/**
 * No org-context guard: guests reach this through the poll's shareable link
 * (spec 4.4). Who may answer as whom (0A Fix 6):
 *   - a signed-in MEMBER of the poll's org answers as themselves;
 *   - everyone else, including a signed-in user of another org, answers as
 *     a guest, and only finalizePoll's membership intersection decides who
 *     becomes an attendee;
 *   - a guest is identified by the httpOnly poll_guest_<pollId> cookie, and
 *     their delete-then-recreate is scoped to its hash, so no visitor can
 *     overwrite another guest's answers by typing the same name.
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
    select: {
      id: true,
      organizationId: true,
      finalizedEventId: true,
      closesAt: true,
      slots: { select: { id: true } },
    },
  });
  if (!poll) return { error: "Poll not found." };
  if (poll.finalizedEventId) return { error: "This poll has already been finalized." };
  if (poll.closesAt && poll.closesAt < new Date()) return { error: "This poll is closed." };

  const validSlotIds = new Set(poll.slots.map((s) => s.id));
  if (data.entries.some((e) => !validSlotIds.has(e.slotId))) {
    return { error: "That slot isn't part of this poll." };
  }

  const session = await getSession();
  const membership = session
    ? await prisma.membership.findUnique({
        where: {
          userId_organizationId: { userId: session.user.id, organizationId: poll.organizationId },
        },
        select: { userId: true },
      })
    : null;

  if (session && membership) {
    await prisma.$transaction(
      data.entries.map((e) =>
        prisma.pollResponse.upsert({
          where: { slotId_userId: { slotId: e.slotId, userId: session.user.id } },
          update: { availability: e.availability },
          create: {
            organizationId: poll.organizationId,
            pollId: poll.id,
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

  const cookieStore = await cookies();
  const cookieName = guestCookieName(poll.id);
  let guestKey = cookieStore.get(cookieName)?.value;
  if (!isWellFormedGuestKey(guestKey)) {
    guestKey = generateGuestKey();
    cookieStore.set(cookieName, guestKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: guestCookiePath(poll.id),
      maxAge: GUEST_KEY_MAX_AGE_SECONDS,
    });
  }
  const guestKeyHash = hashGuestKey(guestKey);

  await prisma.$transaction([
    // Only this guest's own rows: legacy rows (NULL hash) and other guests'
    // rows never match, whatever name was typed.
    prisma.pollResponse.deleteMany({
      where: { pollId: poll.id, userId: null, guestKeyHash },
    }),
    prisma.pollResponse.createMany({
      data: data.entries.map((e) => ({
        organizationId: poll.organizationId,
        pollId: poll.id,
        slotId: e.slotId,
        guestName,
        guestKeyHash,
        availability: e.availability,
      })),
    }),
  ]);
  return {};
}
