import { redirect } from "next/navigation";

import { crmSettingsHref } from "@/lib/crm/settings-sections";

import type { SectionProps } from "./types";

/**
 * Booking link: managed in Meetings > Booking links now (yours and the
 * organization's; docs/features/booking.md). The section page redirects
 * before it gets here; this keeps the section map whole.
 */
export async function BookingSection({ orgSlug }: SectionProps) {
  return redirect(crmSettingsHref(orgSlug, "booking"));
}
