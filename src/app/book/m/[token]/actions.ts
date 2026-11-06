"use server";

import { z } from "zod";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { guestCancel, guestReschedule, verifyBooking, type GuestChange } from "@/server/booking/book";

/**
 * What a guest can do from their own booking page (/book/m/{token}): say
 * the address is theirs, cancel, or pick another time with the same host.
 * The token is the only key (an HMAC of the booking, stored hashed);
 * rate-limited per visitor's address.
 */

const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

async function limited(): Promise<boolean> {
  const r = await checkRateLimit(rateLimitKey("book-manage", await getClientIp()), 30, 3600);
  return !r.allowed;
}

export async function confirmBookingAction(token: string): Promise<GuestChange> {
  if (!TOKEN.safeParse(token).success) return { ok: false, error: "This link isn't valid." };
  if (await limited()) return { ok: false, error: "Too many tries. Wait a little and try again." };
  return (await verifyBooking(token)) ? { ok: true } : { ok: false, error: "This link isn't valid any more." };
}

export async function cancelBookingAction(token: string, reason: string): Promise<GuestChange> {
  if (!TOKEN.safeParse(token).success) return { ok: false, error: "This link isn't valid." };
  if (await limited()) return { ok: false, error: "Too many tries. Wait a little and try again." };
  try {
    return await guestCancel(token, z.string().max(500).catch("").parse(reason));
  } catch (error) {
    console.error("[booking] cancel failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "That didn't go through. Try again." };
  }
}

export async function rescheduleBookingAction(token: string, start: string): Promise<GuestChange> {
  if (!TOKEN.safeParse(token).success) return { ok: false, error: "This link isn't valid." };
  if (await limited()) return { ok: false, error: "Too many tries. Wait a little and try again." };
  try {
    return await guestReschedule(token, z.string().max(40).catch("").parse(start));
  } catch (error) {
    console.error("[booking] reschedule failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "That didn't go through. Try again." };
  }
}
