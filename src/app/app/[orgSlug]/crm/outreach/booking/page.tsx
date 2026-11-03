import { BookingList } from "@/components/crm/outreach/booking";
import { OutreachHeader } from "@/components/crm/outreach/outreach-header";
import { appUrl } from "@/lib/app-url";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Booking pages" };

export default async function BookingPagesPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/booking">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
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
          where: { organizationId: orgId, sourceKind: "event", meta: { path: ["bookingPageId"], equals: p.id } },
        }),
      });
    }
    return out;
  });
  return (
    <div className="space-y-6">
      <OutreachHeader
        orgSlug={orgSlug}
        tabs={shell.tabs}
        view="booking"
        title="Booking pages"
        description="One link, and people pick a time you're free."
      />
      <BookingList orgId={orgId} orgSlug={orgSlug} pages={pages} />
    </div>
  );
}
