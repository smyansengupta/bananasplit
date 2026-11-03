import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { CampaignView } from "@/components/crm/outreach/campaign-view";
import { PageHeader } from "@/components/page-header";
import { campaignProgress, inviteLink, myShare } from "@/server/crm/outreach/campaigns";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/app/[orgSlug]/crm/campaigns/[campaignId]">) {
  const { orgSlug, campaignId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db, userId }) => {
    const c = await db.crmCampaign.findFirst({ where: { id: campaignId, organizationId: orgId } });
    if (!c) return null;
    const progress = await campaignProgress(db, orgId, c.id);
    const rows = await myShare(db, orgId, c.id, userId, true);
    const template = c.templateId
      ? await db.crmTemplate.findFirst({ where: { id: c.templateId, organizationId: orgId }, select: { subject: true, body: true } })
      : null;
    const link = await inviteLink(db, orgId, c.channel, c.eventId);
    const event = c.eventId ? await db.event.findFirst({ where: { id: c.eventId, organizationId: orgId }, select: { title: true } }) : null;
    let message: { subject: string; body: string } | null = template ? { subject: template.subject ?? c.name, body: template.body } : null;
    if (link) {
      const what = event?.title ?? "this";
      message = {
        subject: message?.subject ?? (event ? `Come to ${event.title}` : c.name),
        body: `${message?.body ?? `Hi {{first_name|there}},\n\nWe'd love you to ${event ? `come to ${what}` : "fill this in"}.`}\n\n${link}\n\n{{my_first_name}}`,
      };
    }
    return { c, progress, rows, message };
  });
  if (!data) notFound();
  const { c, progress } = data;
  const due = c.dueOn ? c.dueOn.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : null;
  return (
    <div className="space-y-6">
      <PageHeader title={c.name} description={[c.goal, due ? `By ${due}` : null].filter(Boolean).join(". ") || undefined} tabs={<CrmTabs tabs={shell.tabs} />} />
      <BackLink href={`/app/${orgSlug}/crm/campaigns`} label="Campaigns" />
      <CampaignView
        orgId={orgId}
        orgSlug={orgSlug}
        userId={shell.user.id}
        campaign={{ id: c.id, name: c.name, status: c.status, channel: c.channel, hasList: Boolean(c.viewId) && c.channel !== "bulk" }}
        numbers={{ ...progress, goalCount: c.goalCount }}
        byMember={progress.byMember.map((m) => ({ ...m, name: m.userId ? (names.get(m.userId) ?? "A former member") : "Nobody" }))}
        members={shell.members}
        message={data.message}
        rows={data.rows.map((r) => ({
          id: r.id,
          personId: r.person.id,
          name: r.person.name,
          sub: [r.person.title, r.person.company?.name].filter(Boolean).join(", ") || null,
          email: r.person.primaryEmail,
          phone: r.person.phone,
          status: r.status,
          assigneeId: r.assigneeId,
          blocked: r.blocked,
        }))}
      />
    </div>
  );
}
