import { redirect } from "next/navigation";

import { bookingLinksHref } from "@/lib/crm/settings-sections";

/** Booking pages moved to Meetings > Booking links (docs/features/booking.md). The public page (/book/{slug}) is unchanged. */
export default async function BookingPagesPage({
  params,
}: PageProps<"/app/[orgSlug]/crm/outreach/booking">) {
  const { orgSlug } = await params;
  redirect(bookingLinksHref(orgSlug));
}
