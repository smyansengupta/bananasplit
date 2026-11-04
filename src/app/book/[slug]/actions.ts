"use server";

import { z } from "zod";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { book, type BookResult } from "@/server/crm/outreach/booking";

/**
 * Booking a time on a public booking page: anyone may, rate-limited per
 * address, with a honeypot. The page's organization is found from its slug
 * and everything happens in that one organization (src/server/crm/outreach/booking.ts).
 */

const input = z.object({
  start: z.string().max(40),
  name: z.string().max(200),
  email: z.string().max(254),
  answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
  website: z.string().max(200).optional(),
});

export async function bookAction(slug: string, raw: unknown): Promise<BookResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Something's off. Reload and try again." };
  if (parsed.data.website) return { ok: true, when: "", hostName: "" };
  const ip = await getClientIp();
  const limited = await checkRateLimit(rateLimitKey("crm-book", ip), 10, 3600);
  if (!limited.allowed) return { ok: false, error: "Too many bookings from here. Try again later." };
  try {
    return await book(slug, parsed.data);
  } catch (error) {
    console.error("[crm] booking failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "That didn't go through. Try again." };
  }
}
