import { buildIcsCalendar } from "@/lib/ics";
import { getPublicEvents } from "@/server/cached/public-events";
import {
  feedNotFound,
  feedOptions,
  feedRedirect,
  feedResponse,
  resolveFeedOrg,
} from "@/server/public-events/http";
import { publicIcsEvents } from "@/server/public-events/shape";

/**
 * GET /api/public/{orgSlug}/events.ics — the same public events as an
 * iCalendar feed people can subscribe to. Same filter, cache and headers as
 * the JSON endpoint.
 */

export const runtime = "nodejs";

type Context = { params: Promise<{ orgSlug: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { orgSlug } = await params;
  const org = await resolveFeedOrg(orgSlug);
  if (org.kind === "not-found") return feedNotFound("ics");
  if (org.kind === "redirect") return feedRedirect(request, org.canonicalSlug, "events.ics");
  const feed = await getPublicEvents(org.organizationId);
  if (!feed) return feedNotFound("ics");
  const body = buildIcsCalendar(publicIcsEvents(feed), {
    name: `${feed.orgName} events`,
    description: `Public events of ${feed.orgName}`,
    timeZone: feed.timeZone,
    refreshMinutes: 60,
  });
  return feedResponse(request, {
    body,
    contentType: "text/calendar; charset=utf-8",
    headers: { "Content-Disposition": `inline; filename="${org.slug}-events.ics"` },
  });
}

export async function HEAD(request: Request, context: Context): Promise<Response> {
  return GET(request, context);
}

export function OPTIONS(): Response {
  return feedOptions();
}
