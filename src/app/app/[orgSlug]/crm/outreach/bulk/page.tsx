import Link from "next/link";

import { BulkComposer } from "@/components/crm/outreach/bulk";
import { OutreachHeader } from "@/components/crm/outreach/outreach-header";
import { listsWithCounts } from "@/server/crm/outreach/lists";
import { checkSender } from "@/server/crm/outreach/mailbox";
import { composeTemplates } from "@/server/crm/outreach/view";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Bulk email" };

export default async function BulkPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/outreach/bulk">) {
  const { orgSlug } = await params;
  const { list } = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const sender = await checkSender(orgId).catch(() => ({ ok: false, from: null, domain: null, problem: "We couldn't check your sender just now." }));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const lists = await listsWithCounts(db, orgId, shell.user.id, shell.roles);
    const recent = await db.crmCampaign.findMany({
      where: { organizationId: orgId, channel: "bulk" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, createdAt: true, status: true },
    });
    const stats = [];
    for (const c of recent) {
      const sent = await db.crmEmailMessage.count({ where: { organizationId: orgId, campaignId: c.id, status: "SENT" } });
      const clicked = await db.crmEmailMessage.count({ where: { organizationId: orgId, campaignId: c.id, clickCount: { gt: 0 } } });
      const replied = await db.crmEmailMessage.count({ where: { organizationId: orgId, campaignId: c.id, repliedAt: { not: null } } });
      stats.push({ ...c, sent, clicked, replied });
    }
    return { lists, templates: await composeTemplates(db, orgId), recent: stats };
  });
  return (
    <div className="space-y-6">
      <OutreachHeader
        orgSlug={orgSlug}
        tabs={shell.tabs}
        view="bulk"
        title="Bulk email"
        description="One message to a whole list, each merged for its person, from your organization's own domain."
      />
      <BulkComposer
        orgId={orgId}
        orgSlug={orgSlug}
        lists={data.lists.map((l) => ({ id: l.id, name: l.name, count: l.emailable }))}
        templates={data.templates}
        sender={sender}
        canSend={shell.access.manager}
        initialList={typeof list === "string" ? list : null}
      />
      {data.recent.length > 0 && (
        <section className="bg-card ring-foreground/6 rounded-card space-y-2 p-5 ring-1">
          <h2 className="heading text-base">Sent before</h2>
          <ul className="space-y-1.5 text-sm">
            {data.recent.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/app/${orgSlug}/crm/campaigns/${c.id}`} className="font-semibold hover:underline">
                  {c.name}
                </Link>
                <span className="text-muted-foreground">{c.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="tabular-nums">
                  {c.sent} sent, {c.replied} replied, {c.clicked} clicked
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
