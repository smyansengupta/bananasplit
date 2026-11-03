import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { CrmList, type ListRow } from "@/components/crm/crm-list";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { ownerLabel } from "@/server/crm/owners";
import {
  listPeople,
  parseListQuery,
  peopleStatusCounts,
  PAGE,
  PERSON_SORT_LABELS,
} from "@/server/crm/queries";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";
import { savedViews, toSearch } from "../views";

export const metadata = { title: "People" };

/** Everyone the organization reaches out to, filtered and searched on the server. */
export default async function CrmPeoplePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/people">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const query = parseListQuery(sp);
  const today = new Date();
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const types = shell.access.settings?.relationshipTypes ?? [];
  const base = `/app/${orgSlug}/crm/people`;
  const data = await withOrgTx(shell.org.id, async ({ db }) => ({
    list: await listPeople(db, shell.org.id, query, shell.user.id, shell.roles),
    counts: await peopleStatusCounts(db, shell.org.id, query, shell.user.id, shell.roles),
    views: await savedViews(db, shell.org.id, "people", base, toSearch(sp)),
  }));
  const rows: ListRow[] = data.list.rows.map((p) => ({
    id: p.id,
    name: p.name,
    sub: [p.title, p.companyName].filter(Boolean).join(", ") || null,
    email: p.primaryEmail,
    badge: p.relationship
      ? { label: types.find((t) => t.id === p.relationship)?.label ?? p.relationship }
      : null,
    owner: ownerLabel(p, shell.roles, names),
    lastContactedAt: p.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: p.nextFollowUpAt?.toISOString() ?? null,
    overdue: Boolean(p.nextFollowUpAt && p.nextFollowUpAt < today),
    strength: p.strength,
    deleted: Boolean(p.deletedAt),
  }));
  return (
    <>
    <CrmList
      tabs={<CrmTabs tabs={shell.tabs} />}
      orgId={shell.org.id}
      orgSlug={orgSlug}
      kind="person"
      title="People"
      rows={rows}
      total={data.list.total}
      page={query.page ?? 1}
      pageSize={PAGE}
      counts={data.counts}
      relationshipTypes={types.map((t) => ({ value: t.id, label: t.label }))}
      members={shell.members}
      sortLabels={PERSON_SORT_LABELS}
      views={data.views}
      exportHref={`/app/${orgSlug}/crm/export?kind=people`}
    />
      <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
    </>
  );
}
