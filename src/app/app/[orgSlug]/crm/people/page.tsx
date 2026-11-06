import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { CrmSendingBanner } from "@/components/crm/settings/sending-paused";
import { PeopleBoardView } from "@/components/crm/people/people-board";
import { PeopleEmpty } from "@/components/crm/people/people-empty";
import { PeopleTable } from "@/components/crm/people/people-table";
import { PeopleToolbar } from "@/components/crm/people/people-toolbar";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { ownerParamFor } from "@/lib/crm/scope";
import type { EditField } from "@/lib/crm/record-form";
import { customFieldsFor } from "@/server/crm/databases";
import { peoplePage } from "@/server/crm/people-view";
import { loadSendingHealth } from "@/server/crm/sending-health";
import { PAGE } from "@/server/crm/queries";
import { withOrgTx } from "@/server/db/context";

import { crmMembers, crmShell, crmTeam } from "../shell";

export const metadata = { title: "People" };

type Search = Record<string, string | string[] | undefined>;

/**
 * The CRM's People tab (docs/features/crm.md, "One list"): the one list of
 * everyone you deal with. The header and toolbar, "{list} {count}" (with
 * "$X in open deals" when a deal filter or the board is on), then everyone
 * (?view= people, companies, or board: their deals by stage, drag to move)
 * in one table. A row or a deal opens its card over the page (?open=);
 * Filters picks a list, an owner, a relationship and the deal filters. A
 * brand-new CRM shows what can come in instead.
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
  const orgId = shell.org.id;
  const relationships = shell.access.settings?.relationshipTypes ?? [];
  // The members, the list and the card open over it load at once, each in its own transaction.
  const membersP = crmMembers(orgId);
  const namesP = membersP.then((members) => new Map(members.map((m) => [m.id, m.name])));
  // Read inside the list; an empty CRM never gets there.
  namesP.catch(() => null);
  // My team (?owner=team, as Tasks' scope): the viewer and the people under them on the org chart.
  const team = shell.access.personal ? [] : await crmTeam(orgId, shell.user.id);
  const query: Search = typeof sp.owner === "string" ? { ...sp, owner: ownerParamFor(sp.owner, team) } : sp;
  const listP = withOrgTx(orgId, async ({ db }) => {
    const data = await peoplePage(db, orgId, shell.user.id, shell.roles, query, {
      names: namesP,
      relationships,
      pipelines: shell.pipelines,
    });
    const boardFields = data.board ? await customFieldsFor(db, orgId, "deal", data.board.pipeline.id) : [];
    return { data, boardFields };
  });
  const overlayP = CrmOverlays({ shell, orgSlug, searchParams: sp });
  // The banner starts now rather than after the list, and arrives on its own.
  void loadSendingHealth(orgId).catch(() => null);
  const [members, { data, boardFields }, overlay] = await Promise.all([membersP, listP, overlayP]);

  const base = `/app/${orgSlug}/crm`;
  const reportHref = data.board ? `${base}/reports/deals/${data.board.pipeline.id}` : null;
  const ownerOptions = [
    ...members.map((m) => ({ value: `u:${m.id}`, label: m.name })),
    ...[...shell.roles.values()].map((r) => ({ value: `r:${r.key}`, label: r.title })),
  ];
  const stageFields: EditField[] = [
    { key: "amount", label: "Amount", kind: "CURRENCY", value: null },
    { key: "nextStep", label: "Next step", kind: "TEXT", value: null },
    { key: "nextStepAt", label: "Next step by", kind: "DATE", value: null },
    { key: "expectedOn", label: "Expected", kind: "DATE", value: null },
    { key: "company", label: "Company", kind: "COMPANY", value: null },
    { key: "person", label: "Person", kind: "PERSON", value: null },
    // A Personal space has one owner: a stage never asks for one.
    ...(shell.access.personal
      ? []
      : [{ key: "owner", label: "Owner", kind: "OWNER" as const, value: null, options: ownerOptions }]),
    { key: "closeReason", label: "Reason", kind: "LONG_TEXT", value: null },
    ...boardFields.map((f) => ({
      key: `custom.${f.id}`,
      label: f.name,
      kind: "CUSTOM" as const,
      value: null,
      field: f,
    })),
  ];
  const show = typeof sp.show === "string" ? sp.show : "";

  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        banner={
          <Suspense fallback={null}>
            <CrmSendingBanner orgId={orgId} orgSlug={orgSlug} />
          </Suspense>
        }
        create={data.view === "board" ? "deal" : data.companies ? "company" : "person"}
        toolbar={
          <PeopleToolbar
            orgId={orgId}
            tabs={shell.tabs}
            view={data.view}
            lists={data.lists}
            trash={data.trash}
            members={members}
            relationships={relationships.map((r) => ({ id: r.id, label: r.label }))}
            deals={data.dealOptions}
            reportHref={reportHref}
            personal={shell.access.personal}
            hasTeam={team.length > 0}
          />
        }
      />
      {data.view === "board" ? (
        <PeopleBoardView
          orgId={orgId}
          heading={data.listName}
          total={data.total}
          money={data.money}
          filtered={Boolean(data.listId || data.dealsOn || sp.q || sp.owner || sp.rel)}
          board={
            data.board
              ? {
                  pipeline: data.board.pipeline,
                  stages: data.board.pipeline.stages
                    .filter((s) => {
                      const stage = typeof sp.stage === "string" ? sp.stage : "";
                      if (stage) return s.id === stage;
                      if (show === "all") return true;
                      if (show === "won") return s.kind === "WON";
                      if (show === "lost") return s.kind === "LOST";
                      return s.kind === "OPEN";
                    })
                    .map((s) => ({ id: s.id, name: s.name, kind: s.kind, requiredFields: s.requiredFields })),
                  cards: data.board.rows.map((r) => ({
                    id: r.id,
                    title: r.title,
                    stageId: r.stageId,
                    amountCents: r.amountCents,
                    currency: r.currency,
                    companyName: r.companyName,
                    personName: r.personName,
                    type: r.type,
                    stuck: r.stuck,
                    days: r.days,
                  })),
                  stageFields,
                }
              : null
          }
        />
      ) : data.empty ? (
        <PeopleEmpty
          orgId={orgId}
          orgSlug={orgSlug}
          members={data.empty.members}
          contacts={data.empty.contacts}
        />
      ) : (
        <PeopleTable
          orgId={orgId}
          orgSlug={orgSlug}
          companies={data.companies}
          rows={data.rows}
          total={data.total}
          page={data.page}
          pageSize={PAGE}
          listId={data.listId}
          listName={data.listName}
          money={data.money}
          dealsOn={data.dealsOn}
          trash={sp.trash === "1"}
          pickedLists={data.lists.filter((l) => l.picked).map((l) => ({ id: l.id, label: l.label }))}
          members={members}
          series={data.series}
          personal={shell.access.personal}
          // Group email is for managers (sendBulk); one person is their card's composer.
          canBulkEmail={shell.access.manager}
        />
      )}
      {overlay}
    </div>
  );
}
