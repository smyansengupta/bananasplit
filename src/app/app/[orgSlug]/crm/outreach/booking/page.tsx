import { redirect } from "next/navigation";

/** Booking pages moved into CRM settings > Booking link. The public page (/book/{slug}) is unchanged. */
export default async function BookingPagesPage({
  params,
}: PageProps<"/app/[orgSlug]/crm/outreach/booking">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm/settings/booking`);
}
