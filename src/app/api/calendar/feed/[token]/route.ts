import { NextResponse } from "next/server";

import { buildIcsCalendar } from "@/lib/ics";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

// Generous: real calendar apps poll this every 15-60 min, but nothing
// legitimate needs more than one request a minute.
const FEED_RATE_LIMIT = 60;
const FEED_RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Public, token-authenticated read-only feed — no session required. The
 * token itself is the credential (unguessable, regenerable from Settings),
 * so this can be subscribed to from Google/Apple/Outlook calendar apps.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const rateLimit = checkRateLimit(`ics-feed:${token}`, FEED_RATE_LIMIT, FEED_RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { icsToken: token } });
  if (!user) {
    return new NextResponse("Not found", { status: 404 });
  }

  const events = await prisma.event.findMany({
    where: { deletedAt: null, attendees: { some: { userId: user.id } } },
    orderBy: { startsAt: "asc" },
  });

  const ics = buildIcsCalendar(
    events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      updatedAt: event.updatedAt,
    })),
    `${user.name ?? "CBC Portal"} — CBC Portal`,
  );

  return new NextResponse(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
}
