import { appUrl } from "@/lib/app-url";
import { withHost } from "@/lib/booking/guest";
import { buildIcsCalendar } from "@/lib/ics";
import { guestView } from "@/server/booking/book";
import { BOOKING_TOKEN_RE } from "@/server/booking/token";

/** GET /book/m/{token}/calendar.ics: the booked meeting for the guest's calendar app. */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!BOOKING_TOKEN_RE.test(token)) return NOT_FOUND();
  const view = await guestView(token);
  if (!view || view.status !== "BOOKED") return NOT_FOUND();
  const pageUrl = appUrl(`/book/m/${token}`);
  const body = buildIcsCalendar(
    [
      {
        id: `booking-${view.bookingId}`,
        title: withHost(view.title, view.hostName),
        description: [view.joinUrl, `Move or cancel: ${pageUrl}`].filter(Boolean).join("\n\n"),
        location: view.joinUrl ?? view.location,
        startsAt: view.startsAt,
        endsAt: view.endsAt,
        allDay: false,
        updatedAt: new Date(),
        url: pageUrl,
      },
    ],
    { name: view.title, timeZone: view.guestTz ?? view.tz },
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meeting.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
