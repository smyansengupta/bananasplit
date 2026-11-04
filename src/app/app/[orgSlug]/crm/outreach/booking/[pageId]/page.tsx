import { redirect } from "next/navigation";

/** One booking page now opens under CRM settings > Booking link. */
export default async function BookingPageEditor({
  params,
}: PageProps<"/app/[orgSlug]/crm/outreach/booking/[pageId]">) {
  const { orgSlug, pageId } = await params;
  redirect(`/app/${orgSlug}/crm/settings/booking/${encodeURIComponent(pageId)}`);
}
