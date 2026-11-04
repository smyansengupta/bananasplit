import { redirect } from "next/navigation";

import { bookingLinksHref } from "@/lib/crm/settings-sections";

/** One booking page opens in Meetings > Booking links, its editor open (docs/features/booking.md). */
export default async function BookingPageEditor({
  params,
}: PageProps<"/app/[orgSlug]/crm/outreach/booking/[pageId]">) {
  const { orgSlug, pageId } = await params;
  redirect(bookingLinksHref(orgSlug, pageId));
}
