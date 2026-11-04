import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { BookingList } from "@/components/crm/outreach/booking";
import { appUrl } from "@/lib/app-url";
import { withOrgTx } from "@/server/db/context";

import type { SectionProps } from "./types";

/**
 * Booking link: every booking page (yours and the shared team ones), each
 * opening at /crm/settings/booking/{id}. The public page itself is
 * /book/{slug}.
 */
export async function BookingSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const pages = await withOrgTx(orgId, async ({ db }) => {
    const rows = await db.crmBookingPage.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const out = [];
    for (const p of rows) {
      out.push({
        id: p.id,
        title: p.title,
        url: appUrl(`/book/${p.slug}`),
        active: p.active,
        durationMin: p.durationMin,
        hosts: p.hostIds.map((h) => names.get(h)).filter((n): n is string => Boolean(n)),
        booked: await db.crmActivity.count({
          where: {
            organizationId: orgId,
            sourceKind: "event",
            meta: { path: ["bookingPageId"], equals: p.id },
          },
        }),
      });
    }
    return out;
  });
  return (
    <SettingsCard
      title="Booking pages"
      description="Share one link and people pick a time you're free. Busy times on your calendar are hidden, and what's booked lands in Meetings and on their timeline."
    >
      <BookingList orgId={orgId} orgSlug={orgSlug} pages={pages} />
    </SettingsCard>
  );
}
