import type { ConferenceProvider } from "@/generated/prisma/enums";
import { readAddOns } from "@/lib/addons";
import { spaceIncludes } from "@/lib/billing/space";
import { CONFERENCE_PROVIDER_OF } from "@/lib/meetings/connected-provider";
import { MEETING_INTEGRATIONS } from "@/server/conference/providers";
import type { TxClient } from "@/server/db/context";

/**
 * What a space may do with booking links (docs/features/booking.md, "Who
 * gets what"):
 * - Every member of every space has their own link, on any plan, with or
 *   without the CRM.
 * - Organization links (shared: round-robin or one named host, used by the
 *   CRM) need the CRM: on the plan and added (Integrations and apps), the
 *   same gate as /crm. A Personal space has none (it's just you).
 * - The CRM side of a booking (the guest as a person, the meeting on their
 *   timeline, a deal, follow-ups stopped) runs when the CRM is set up too.
 */

export interface BookingAccess {
  personal: boolean;
  /** Organization links can be made and booked. */
  orgLinks: boolean;
  /** Bookings also go into the CRM. */
  crm: boolean;
  timezone: string;
  name: string;
  slug: string;
}

export async function bookingAccess(db: TxClient, organizationId: string, now = new Date()): Promise<BookingAccess> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true, timezone: true, name: true, slug: true },
  });
  if (!org) return { personal: false, orgLinks: false, crm: false, timezone: "UTC", name: "", slug: "" };
  const settings = await db.orgSettings.findUnique({ where: { organizationId }, select: { addOns: true } });
  const onPlan = spaceIncludes(org, "crm", now) && readAddOns(settings?.addOns).includes("crm");
  const crmSettings = onPlan
    ? await db.crmSettings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } })
    : null;
  const personal = org.kind === "PERSONAL";
  return {
    personal,
    orgLinks: onPlan && !personal,
    crm: onPlan && Boolean(crmSettings?.setupDoneAt),
    timezone: org.timezone ?? "UTC",
    name: org.name,
    slug: org.slug,
  };
}

/** The video account a new booking's meeting is made on: the first one connected, or null. */
export async function connectedVideo(db: TxClient, organizationId: string): Promise<ConferenceProvider | null> {
  const rows = await db.orgIntegration.findMany({
    where: { organizationId, provider: { in: [...MEETING_INTEGRATIONS] }, status: "CONNECTED" },
    select: { provider: true },
  });
  for (const integration of MEETING_INTEGRATIONS) {
    if (rows.some((r) => r.provider === integration)) {
      const p = CONFERENCE_PROVIDER_OF[integration];
      if (p) return p;
    }
  }
  return null;
}
