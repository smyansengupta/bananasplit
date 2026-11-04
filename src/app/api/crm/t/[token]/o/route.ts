import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { recordTracking } from "@/server/crm/outreach/public";

/**
 * The CRM's open pixel (docs/features/crm.md, module 5): a 1x1 GIF in each
 * tracked email. Opens are approximate (mail apps preload pixels), so the
 * CRM leads with replies, clicks and bookings. Always answers the pixel,
 * whatever the token, so it says nothing about which emails exist.
 */

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await checkRateLimit(rateLimitKey("crm-open", token), 30, 3600);
  if (limited.allowed) await recordTracking(token, "open").catch(() => false);
  return new Response(new Uint8Array(GIF), {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
      "Content-Length": String(GIF.length),
    },
  });
}
