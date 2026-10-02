"use server";

import { cookies } from "next/headers";
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
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { withSystemOrgTx } from "@/server/db/context";

import { pollOrgId } from "./poll-org";

const RESPONSE_RATE_LIMIT = 30;
const RESPONSE_RATE_WINDOW_SEC = 60;

const submitSchema = z.object({
  pollId: z.string().min(1).max(100),
  guestName: z.string().trim().max(100).nullable().optional(),
  entries: z
    .array(z.object({ slotId: z.string().min(1).max(100), availability: z.enum(PollAvailability) }))
    .max(2000),
});

interface ActionResult {
  error?: string;
}

/**
 * No org-context guard: guests reach this through the poll's shareable link.
 * It runs on the service path (withSystemOrgTx with the poll's org, found
 * through app.poll_org_id). Who may answer as whom (0A Fix 6):
 *   - a signed-in MEMBER of the poll's org answers as themselves;
 *   - everyone else, including a signed-in user of another org, answers as
 *     a guest, and only finalizePoll's membership intersection decides who
 *     becomes an attendee;
 *   - a guest is identified by the httpOnly poll_guest_<pollId> cookie, and
 *     their delete-then-recreate is scoped to its hash, so no visitor can
 *     overwrite another guest's answers by typing the same name.
 * The entries are the respondent's whole answer: a time left out is cleared.
 * A NO (sent by a page loaded before the grid dropped it) clears too.
 */
export async function submitPollResponse(input: unknown): Promise<ActionResult> {
  const rateLimit = await checkRateLimit(
    rateLimitKey("poll-response", await getClientIp()),
    RESPONSE_RATE_LIMIT,
    RESPONSE_RATE_WINDOW_SEC,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many responses submitted recently. Wait a moment and try again." };
  }

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  const organizationId = await pollOrgId(data.pollId);
  if (!organizationId) return { error: "Poll not found." };

  const session = await getSession();
  const userId = session?.user.id ?? null;

  // The guest cookie is read (and minted) outside the transaction.
  const cookieStore = await cookies();
  const cookieName = guestCookieName(data.pollId);
  const existingKey = cookieStore.get(cookieName)?.value;

  type Outcome = { error: string } | { ok: true; guestKey?: string };
  const outcome: Outcome = await withSystemOrgTx(organizationId, { userId }, async ({ db }) => {
    const poll = await db.availabilityPoll.findFirst({
      where: { id: data.pollId, organizationId },
      select: { id: true, finalizedEventId: true, closesAt: true, slots: { select: { id: true } } },
    });
    if (!poll) return { error: "Poll not found." };
    if (poll.finalizedEventId) return { error: "This poll has already been finalized." };
    if (poll.closesAt && poll.closesAt < new Date()) return { error: "This poll is closed." };
    const validSlotIds = new Set(poll.slots.map((s) => s.id));
    if (data.entries.some((e) => !validSlotIds.has(e.slotId))) {
      return { error: "That slot isn't part of this poll." };
    }
    const answers = data.entries.filter((e) => e.availability !== PollAvailability.NO);

    const isMember = userId
      ? (await db.membership.count({ where: { organizationId, userId } })) > 0
      : false;

    if (userId && isMember) {
      await db.pollResponse.deleteMany({
        where: { organizationId, pollId: poll.id, userId, slotId: { notIn: answers.map((e) => e.slotId) } },
      });
      for (const e of answers) {
        await db.pollResponse.upsert({
          where: { slotId_userId: { slotId: e.slotId, userId } },
          update: { availability: e.availability },
          create: {
            organizationId,
            pollId: poll.id,
            slotId: e.slotId,
            userId,
            availability: e.availability,
          },
        });
      }
      return { ok: true };
    }

    const guestName = data.guestName?.trim();
    if (!guestName) return { error: "Enter your name to respond." };
    const guestKey = isWellFormedGuestKey(existingKey) ? existingKey : generateGuestKey();
    const guestKeyHash = hashGuestKey(guestKey);
    // Only this guest's own rows: legacy rows (NULL hash) and other guests'
    // rows never match, whatever name was typed.
    await db.pollResponse.deleteMany({ where: { organizationId, pollId: poll.id, userId: null, guestKeyHash } });
    if (answers.length > 0) {
      await db.pollResponse.createMany({
        data: answers.map((e) => ({
          organizationId,
          pollId: poll.id,
          slotId: e.slotId,
          guestName,
          guestKeyHash,
          availability: e.availability,
        })),
      });
    }
    return { ok: true, guestKey };
  });

  if ("error" in outcome) return { error: outcome.error };
  if (outcome.guestKey && outcome.guestKey !== existingKey) {
    cookieStore.set(cookieName, outcome.guestKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: guestCookiePath(data.pollId),
      maxAge: GUEST_KEY_MAX_AGE_SECONDS,
    });
  }
  return {};
}
