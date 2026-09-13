import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { buildIcsCalendar } from "@/lib/ics";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null },
  });
  if (!event) {
    return new NextResponse("Not found", { status: 404 });
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId: session.user.id, organizationId: event.organizationId },
    },
  });
  if (!membership) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ics = buildIcsCalendar([
    {
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      updatedAt: event.updatedAt,
    },
  ]);

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.id}.ics"`,
    },
  });
}
