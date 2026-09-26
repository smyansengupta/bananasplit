import { getPublicEvents } from "@/server/cached/public-events";
import {
  feedNotFound,
  feedOptions,
  feedRedirect,
  feedResponse,
  resolveFeedOrg,
} from "@/server/public-events/http";
import { publicEventsJson } from "@/server/public-events/shape";

/**
 * GET /api/public/{orgSlug}/events — the org's upcoming PUBLIC events as
 * JSON, in the club website's ClubEvent shape (plus kind, full, featured and
 * note). Read-only, no cookies, opt-in per org (Settings > Privacy), cached
 * at the CDN and in the Next.js data cache. See docs/features/calendar.md.
 */

export const runtime = "nodejs";

type Context = { params: Promise<{ orgSlug: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { orgSlug } = await params;
  const org = await resolveFeedOrg(orgSlug);
  if (org.kind === "not-found") return feedNotFound("json");
  if (org.kind === "redirect") return feedRedirect(request, org.canonicalSlug, "events");
  const feed = await getPublicEvents(org.organizationId);
  if (!feed) return feedNotFound("json");
  return feedResponse(request, {
    body: publicEventsJson(feed),
    contentType: "application/json; charset=utf-8",
  });
}

export async function HEAD(request: Request, context: Context): Promise<Response> {
  return GET(request, context);
}

export function OPTIONS(): Response {
  return feedOptions();
}
