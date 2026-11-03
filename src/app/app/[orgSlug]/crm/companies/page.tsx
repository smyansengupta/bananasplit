import { CrmList, type ListRow } from "@/components/crm/crm-list";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { ownerLabel } from "@/server/crm/owners";
import {
  COMPANY_SORT_LABELS,
  companyStatusCounts,
  listCompanies,
  PAGE,
  parseListQuery,
} from "@/server/crm/queries";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";
import { savedViews, toSearch } from "../views";

export const metadata = { title: "Companies" };

/** The companies on the other side: businesses, schools, foundations, venues. */
export default async function CrmCompaniesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/companies">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const query = parseListQuery(sp);
  const today = new Date();
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const base = `/app/${orgSlug}/crm/companies`;
  const data = await withOrgTx(shell.org.id, async ({ db }) => ({
    list: await listCompanies(db, shell.org.id, query, shell.user.id, shell.roles),
    counts: await companyStatusCounts(db, shell.org.id, query, shell.user.id, shell.roles),
    views: await savedViews(db, shell.org.id, "companies", base, toSearch(sp)),
  }));
  const rows: ListRow[] = data.list.rows.map((c) => ({
    id: c.id,
    name: c.name,
    sub: [c.domain, c.industry].filter(Boolean).join(", ") || null,
    badge: null,
    extra: c.people === 0 ? "" : c.people === 1 ? "1 person" : `${c.people} people`,
    owner: ownerLabel(c, shell.roles, names),
    lastContactedAt: c.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: c.nextFollowUpAt?.toISOString() ?? null,
    overdue: Boolean(c.nextFollowUpAt && c.nextFollowUpAt < today),
    strength: c.strength,
    deleted: Boolean(c.deletedAt),
  }));
  return (
    <CrmList
      tabs={<CrmTabs tabs={shell.tabs} />}
      orgId={shell.org.id}
      orgSlug={orgSlug}
      kind="company"
      title="Companies"
      rows={rows}
      total={data.list.total}
      page={query.page ?? 1}
      pageSize={PAGE}
      counts={data.counts}
      relationshipTypes={[]}
      members={shell.members}
      sortLabels={COMPANY_SORT_LABELS}
      views={data.views}
      exportHref={`/app/${orgSlug}/crm/export?kind=companies`}
    />
  );
}
