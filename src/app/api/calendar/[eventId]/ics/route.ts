import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { icsEventSelect, toIcsEvent } from "@/lib/calendar-feed";
import { buildIcsCalendar } from "@/lib/ics";
import { contentDisposition } from "@/lib/http/content-disposition";
import { withOrgTx, withUserTx } from "@/server/db/context";

const EVENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * One event as a downloadable .ics, for a signed-in member of its org. The
 * event is looked up in each of the user's orgs through withOrgTx (app_user
 * under RLS), so another org's event is simply not found.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!EVENT_ID.test(eventId)) return new NextResponse("Not found", { status: 404 });

  const orgs = await withUserTx(session.user.id, ({ db }) =>
    db.membership.findMany({
      where: { userId: session.user.id },
      select: { organization: { select: { id: true, timezone: true, deletedAt: true } } },
    }),
  );
  for (const { organization: org } of orgs) {
    if (org.deletedAt) continue;
    const row = await withOrgTx(org.id, ({ db }) =>
      db.event.findFirst({
        where: { id: eventId, organizationId: org.id, deletedAt: null },
        select: icsEventSelect,
      }),
    );
    if (!row) continue;
    const ics = buildIcsCalendar([toIcsEvent(row, org.timezone)], { timeZone: org.timezone });
    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": contentDisposition("attachment", `${row.id}.ics`),
        "Cache-Control": "private, no-store",
      },
    });
  }
  return new NextResponse("Not found", { status: 404 });
}
