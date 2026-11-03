import { CrmTabs } from "@/components/crm/crm-tabs";
import { Duplicates } from "@/components/crm/duplicates";
import { PageHeader } from "@/components/page-header";
import { pendingDuplicates } from "@/server/crm/dedupe";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Duplicates" };

/** People and companies that look like the same one, to merge or tell apart. */
export default async function CrmReviewPage({ params }: PageProps<"/app/[orgSlug]/crm/review">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const items = await withOrgTx(shell.org.id, ({ db }) => pendingDuplicates(db, shell.org.id));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Duplicates"
        description="Merging keeps everything: addresses, items, the timeline and the history."
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <Duplicates
        orgId={shell.org.id}
        orgSlug={orgSlug}
        items={items.map((d) => ({
          id: d.id,
          object: d.object,
          score: d.score,
          reasons: d.reasons,
          records: d.records.map((r) => ({ ...r, added: r.createdAt.toISOString() })),
        }))}
      />
    </div>
  );
}
