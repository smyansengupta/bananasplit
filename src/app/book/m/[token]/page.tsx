import type { Metadata } from "next";

import { ManageBooking } from "@/components/booking/manage-booking";
import { PublicFrame, PublicNotice } from "@/components/crm/outreach/public-frame";
import { withHost } from "@/lib/booking/guest";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { guestView } from "@/server/booking/book";
import { BOOKING_TOKEN_RE } from "@/server/booking/token";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

/**
 * A guest's own booking (/book/m/{token}, the link in every email about
 * it): what's booked, Confirm it's me until they have, Pick another time
 * (the same host's open times) and Cancel. Nothing changes on opening it:
 * every change is a button, so mail scanners that open links do nothing.
 */
export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!BOOKING_TOKEN_RE.test(token)) {
    return <PublicNotice title="This link isn't valid" body="Use the link in your booking email." />;
  }
  const limited = await checkRateLimit(rateLimitKey("book-manage-view", await getClientIp()), 120, 3600);
  if (!limited.allowed) return <PublicNotice title="Too many visits" body="Try again in a little while." />;
  const view = await guestView(token, new Date(), true);
  if (!view) return <PublicNotice title="This link isn't valid any more" body="Use the link in your most recent booking email." />;
  return (
    <PublicFrame orgName={view.orgName} title={withHost(view.title, view.hostName)}>
      <ManageBooking
        token={token}
        status={view.status}
        past={view.past}
        verified={view.verified}
        startsAt={view.startsAt.toISOString()}
        durationMin={view.durationMin}
        tz={view.guestTz ?? view.tz}
        joinUrl={view.joinUrl}
        location={view.location}
        slots={view.slots}
        bookAgainHref={`/book/${view.slug}`}
      />
    </PublicFrame>
  );
}
