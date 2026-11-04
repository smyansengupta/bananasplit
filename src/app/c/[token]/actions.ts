"use server";

import { z } from "zod";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { saveSelfUpdate, type SelfUpdateResult } from "@/server/crm/outreach/self-update";

/** A contact saving their own details from their private link; rate-limited per address. */

const input = z.object({
  name: z.string().max(200),
  email: z.string().max(254),
  title: z.string().max(200),
  phone: z.string().max(60),
  company: z.string().max(200),
});

export async function saveDetailsAction(token: string, raw: unknown): Promise<SelfUpdateResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Something's off. Reload and try again." };
  const limited = await checkRateLimit(rateLimitKey("crm-self", await getClientIp()), 20, 3600);
  if (!limited.allowed) return { ok: false, error: "Too many changes from here. Try again later." };
  try {
    return await saveSelfUpdate(token, parsed.data);
  } catch (error) {
    console.error("[crm] self-update failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "That didn't save. Try again." };
  }
}
