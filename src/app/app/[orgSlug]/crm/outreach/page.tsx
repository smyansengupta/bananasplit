import { OutreachHeader } from "@/components/crm/outreach/outreach-header";
import { TemplatesView } from "@/components/crm/outreach/templates";
import { ensureStarters } from "@/server/crm/outreach/templates";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Outreach" };

/**
 * Outreach (docs/features/crm.md, module 5): templates first. The first
 * visit adds three starters to edit (a hello, a thank-you, an ask).
 */
export default async function OutreachPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const templates = await withOrgTx(orgId, async (ctx) => {
    await ensureStarters(ctx);
    const rows = await ctx.db.crmTemplate.findMany({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: { id: true, name: true, category: true, subject: true, body: true, shared: true, createdById: true },
    });
    const uses = await ctx.db.crmEmailMessage.groupBy({
      by: ["templateId"],
      where: { organizationId: orgId, templateId: { in: rows.map((r) => r.id) }, status: "SENT" },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      ...r,
      mine: r.createdById === ctx.userId,
      uses: uses.find((u) => u.templateId === r.id)?._count._all ?? 0,
    }));
  });
  return (
    <div className="space-y-6">
      <OutreachHeader
        orgSlug={orgSlug}
        tabs={shell.tabs}
        view="templates"
        title="Outreach"
        description="Templates, sequences, booking pages and bulk email. Replies, clicks and bookings are what count."
      />
      <TemplatesView orgId={orgId} templates={templates} canEditAll={shell.access.admin} />
    </div>
  );
}
