"use server";

import { z } from "zod";

import { normalizeEmail } from "@/lib/crm/dedupe";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { book, type BookResult } from "@/server/booking/book";

/**
 * Booking a time on a public booking link: anyone may, with a honeypot,
 * input limits and three rate limits (docs/features/booking.md, "Spam and
 * abuse"): per visitor's address, per guest email address, and the link's
 * own caps in book(). The link's organization is found from its slug and
 * everything happens in that one organization.
 */

const input = z.object({
  start: z.string().max(40),
  durationMin: z.number().int().min(5).max(480).optional(),
  name: z.string().max(200),
  email: z.string().max(254),
  answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
  timeZone: z.string().max(64).optional(),
  website: z.string().max(200).optional(),
});

export async function bookAction(slug: string, raw: unknown): Promise<BookResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Something's off. Reload and try again." };
  // The honeypot: a person never fills the hidden field. Looks booked, does nothing.
  if (parsed.data.website) return { ok: true, when: "", hostName: "", email: "" };
  const ip = await getClientIp();
  const perVisitor = await checkRateLimit(rateLimitKey("book", ip), 10, 3600);
  if (!perVisitor.allowed) return { ok: false, error: "Too many bookings from here. Try again later." };
  const email = normalizeEmail(parsed.data.email);
  if (email) {
    const perAddress = await checkRateLimit(rateLimitKey("book-email", email), 3, 86_400);
    if (!perAddress.allowed) return { ok: false, error: "Too many bookings for that address today. Try again tomorrow." };
  }
  try {
    return await book(slug, parsed.data);
  } catch (error) {
    console.error("[booking] booking failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "That didn't go through. Try again." };
  }
}
