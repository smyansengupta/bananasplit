import { redirect } from "next/navigation";

import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { PeopleEmpty } from "@/components/crm/people/people-empty";
import { PeopleTable } from "@/components/crm/people/people-table";
import { PeopleToolbar } from "@/components/crm/people/people-toolbar";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { peoplePage } from "@/server/crm/people-view";
import { PAGE } from "@/server/crm/queries";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "People" };

type Search = Record<string, string | string[] | undefined>;

/**
 * The CRM's People tab (docs/features/crm.md, "Redesign"; People.dc.html):
 * the header and toolbar, "{list} {count}", then everyone (or every
 * company, ?view=companies) in one table. A row opens its card over the
 * page (?open=); Filters picks a list (?list=), an owner and a
 * relationship. A brand-new CRM shows what can come in instead.
 */
export default async function CrmPeoplePage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/people">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Search;
  // Old "New person" links (?new=1) open the New card.
  if (sp.new === "1") {
    const rest = { ...sp };
    delete rest.new;
    redirect(
      hrefWithOpen(`/app/${orgSlug}/crm/people`, rest, {
        kind: "new",
        what: sp.view === "companies" ? "company" : "person",
      }),
    );
  }
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const relationships = shell.access.settings?.relationshipTypes ?? [];
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(shell.org.id, ({ db }) =>
    peoplePage(db, shell.org.id, shell.user.id, shell.roles, sp, { names, relationships }),
  );

  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        settings={shell.access.manager}
        create={data.companies ? "company" : "person"}
        toolbar={
          <PeopleToolbar
            tabs={shell.tabs}
            companies={data.companies}
            lists={data.lists}
            trash={data.trash}
            members={shell.members}
            relationships={relationships.map((r) => ({ id: r.id, label: r.label }))}
          />
        }
      />
      {data.empty ? (
        <PeopleEmpty
          orgId={shell.org.id}
          orgSlug={orgSlug}
          members={data.empty.members}
          contacts={data.empty.contacts}
        />
      ) : (
        <PeopleTable
          orgId={shell.org.id}
          orgSlug={orgSlug}
          companies={data.companies}
          rows={data.rows}
          total={data.total}
          page={data.page}
          pageSize={PAGE}
          listId={data.listId}
          listName={data.listName}
          trash={sp.trash === "1"}
          pickedLists={data.lists.filter((l) => l.picked).map((l) => ({ id: l.id, label: l.label }))}
          members={shell.members}
        />
      )}
      <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
    </div>
  );
}
