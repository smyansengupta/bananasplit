import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { TemplatesView } from "@/components/crm/outreach/templates";
import { ensureStarters } from "@/server/crm/outreach/templates";
import { withOrgTx } from "@/server/db/context";

import type { SectionProps } from "./types";

/** Templates: the organization's shared ones and your own; the first visit adds three starters to edit. */
export async function TemplatesSection({ shell }: SectionProps) {
  const orgId = shell.org.id;
  const templates = await withOrgTx(orgId, async (ctx) => {
    await ensureStarters(ctx);
    const rows = await ctx.db.crmTemplate.findMany({
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
    <SettingsCard
      title="Templates"
      description="Merge fields fill in for each person. Missing ones are flagged before anything sends."
    >
      <TemplatesView orgId={orgId} templates={templates} canEditAll={shell.access.manager} />
    </SettingsCard>
  );
}
