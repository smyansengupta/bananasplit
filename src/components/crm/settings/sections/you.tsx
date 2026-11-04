import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { TemplatesView } from "@/components/crm/outreach/templates";
import { appUrl } from "@/lib/app-url";
import { bookingLinksHref } from "@/lib/crm/settings-sections";
import { ensureMemberSettings } from "@/server/crm/outreach/member";
import { ensureStarters } from "@/server/crm/outreach/templates";
import { withOrgTx } from "@/server/db/context";

import { RecentCalls } from "../recent-calls";
import { SettingsMore } from "../settings-more";
import { MailExtrasCard, YourBookingCard, YourMailCard } from "../you-settings";
import { HandedToYou } from "./handover";
import type { SectionProps } from "./types";

/**
 * You: your mail (signature, logging address, what it shares), your booking
 * link, templates (the organization's shared ones and your own; the first
 * visit adds three starters to edit), the people handed to you lately
 * (?role= for a position's) and your recent calls. Only you see these.
 */
export async function YouSection({ shell, orgSlug, sp }: SectionProps) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async (ctx) => {
    const { db, userId } = ctx;
    await ensureStarters(ctx);
    const rows = await db.crmTemplate.findMany({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        category: true,
        subject: true,
        body: true,
        shared: true,
        createdById: true,
      },
    });
    const uses = await db.crmEmailMessage.groupBy({
      by: ["templateId"],
      where: { organizationId: orgId, templateId: { in: rows.map((r) => r.id) }, status: "SENT" },
      _count: { _all: true },
    });
    return {
      settings: await ensureMemberSettings(db, orgId, userId),
      // Your own meeting link (Meetings > Meeting links; made the first time it's needed).
      booking: await db.crmBookingPage.findFirst({
        where: { organizationId: orgId, ownerUserId: userId },
        select: { id: true, slug: true, active: true },
      }),
      templates: rows.map((r) => ({
        ...r,
        mine: r.createdById === userId,
        uses: uses.find((u) => u.templateId === r.id)?._count._all ?? 0,
      })),
    };
  });
  const name = shell.members.find((m) => m.id === shell.user.id)?.name ?? shell.user.name ?? "You";
  return (
    <>
      <YourMailCard
        orgId={orgId}
        name={name}
        signature={data.settings.signature ?? ""}
        bccAddress={data.settings.bccAddress}
        shareMode={data.settings.shareMode}
      />
      <YourBookingCard
        orgId={orgId}
        url={data.booking?.active ? appUrl(`/book/${data.booking.slug}`) : null}
        href={bookingLinksHref(orgSlug, data.booking?.id ?? null)}
      />
      <SettingsCard id="templates" title="Templates">
        <TemplatesView
          orgId={orgId}
          templates={data.templates}
          canEditAll={shell.access.manager}
        />
      </SettingsCard>
      <HandedToYou shell={shell} orgSlug={orgSlug} role={sp.role} />
      <SettingsMore>
        <MailExtrasCard
          orgId={orgId}
          bccAddress={data.settings.bccAddress}
          neverLog={data.settings.neverLog}
        />
        <RecentCalls orgId={orgId} orgSlug={orgSlug} userId={shell.user.id} />
      </SettingsMore>
    </>
  );
}
