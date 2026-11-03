import { CrmTabs } from "@/components/crm/crm-tabs";
import { ListsAndCampaigns } from "@/components/crm/outreach/campaigns";
import { PageHeader } from "@/components/page-header";
import { campaignProgress } from "@/server/crm/outreach/campaigns";
import { listsWithCounts } from "@/server/crm/outreach/lists";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Campaigns" };

/** Lists and campaigns (docs/features/crm.md, module 5). */
export default async function CampaignsPage({ params }: PageProps<"/app/[orgSlug]/crm/campaigns">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const userId = shell.user.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const lists = await listsWithCounts(db, orgId, userId, shell.roles);
    const rows = await db.crmCampaign.findMany({
      where: { organizationId: orgId, status: { not: "ARCHIVED" } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 40,
      select: { id: true, name: true, goal: true, dueOn: true, status: true, channel: true },
    });
    const campaigns = [];
    for (const c of rows) {
      const p = await campaignProgress(db, orgId, c.id);
      campaigns.push({
        ...c,
        dueOn: c.dueOn?.toISOString() ?? null,
        total: p.total,
        contacted: p.contacted,
        replied: p.replied,
        booked: p.booked,
        converted: p.converted,
        mine: await db.crmCampaignTarget.count({ where: { organizationId: orgId, campaignId: c.id, assigneeId: userId, status: "TODO" } }),
      });
    }
    const templates = await db.crmTemplate.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 50 });
    const sequences = await db.crmSequence.findMany({ where: { organizationId: orgId, archivedAt: null, status: "ON" }, select: { id: true, name: true }, take: 50 });
    const events = await db.event.findMany({
      where: { organizationId: orgId, deletedAt: null, rsvpEnabled: true, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 20,
      select: { id: true, title: true },
    });
    const forms = await db.form.findMany({
      where: { organizationId: orgId, deletedAt: null, publishedAt: { not: null }, closedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, title: true },
    });
    return {
      lists: lists.map((l) => ({ id: l.id, name: l.name, count: l.count, emailable: l.emailable })),
      campaigns,
      choices: {
        templates,
        sequences,
        events: events.map((e) => ({ id: e.id, name: e.title })),
        forms: forms.map((f) => ({ id: f.id, name: f.title })),
        members: shell.members,
        relationshipTypes: (shell.access.settings?.relationshipTypes ?? []).map((t) => ({ value: t.id, label: t.label })),
      },
    };
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="A list, a goal and a date, split among members. Replies, bookings and conversions are what count."
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <ListsAndCampaigns orgId={orgId} orgSlug={orgSlug} userId={userId} {...data} />
    </div>
  );
}
