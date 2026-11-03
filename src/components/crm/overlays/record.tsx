import { RecordCard, type RecordCardData } from "@/components/crm/cards/record-card";
import { formatMoney } from "@/lib/crm/fields";
import { crmDatabaseIds } from "@/server/crm/databases";
import { companyForm, dealForm, formContext, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { presentHistory, presentTimeline } from "@/server/crm/present";
import { loadCompany, loadDeal } from "@/server/crm/records";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

/**
 * Companies and deals as cards (?open=company:<id>, ?open=deal:<id>): who
 * and what they are, their people, timeline and details. The plain first
 * cut; the Company and Deal cards of the redesign replace these entries in
 * CRM_CARDS.
 */

export async function CompanyOverlay({ shell, orgSlug, open }: OverlayProps<"company">) {
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadCompany(db, orgId, orgSlug, open.id);
    if (!loaded) return null;
    const ids = await crmDatabaseIds(db, orgId);
    const def = ids.companies
      ? await db.databaseDefinition.findFirst({
          where: { id: ids.companies, organizationId: orgId },
          select: { columns: true },
        })
      : null;
    const fctx = await formContext(db, orgId, shell.roles);
    const form = await withRelationLabels(
      db,
      orgId,
      companyForm(loaded.company, loaded.fields, fctx, def?.columns),
    );
    return { ...loaded, form, timelineItems: await presentTimeline(db, orgId, loaded.timeline) };
  });
  if (!data) return <RecordCard orgId={orgId} orgSlug={orgSlug} data={null} />;
  const { company } = data;
  const card: RecordCardData = {
    kind: "company",
    id: company.id,
    name: company.name,
    subtitle: [company.industry, company.domain].filter(Boolean).join(", ") || null,
    deleted: Boolean(company.deletedAt),
    facts: [
      { label: "Owner", value: ownerLabel(company, shell.roles, names) ?? "Nobody" },
      ...(data.money.count
        ? [
            {
              label: "Received",
              value: `${formatMoney(data.money.received)} of ${formatMoney(data.money.pledged)}`,
            },
          ]
        : []),
    ],
    people: data.people.map((p) => ({ id: p.id, name: p.name, sub: p.title })),
    deals: data.deals.map((d) => ({
      id: d.id,
      title: d.title,
      sub: `${d.stage.name}, ${d.pipeline.name}`,
      amount: d.amountCents !== null ? formatMoney(d.amountCents, d.currency) : null,
    })),
    form: data.form,
    timeline: data.timelineItems,
    history: presentHistory(data.history, "company", data.fields, names),
    members: Object.fromEntries(names),
  };
  return <RecordCard orgId={orgId} orgSlug={orgSlug} data={card} />;
}

export async function DealOverlay({ shell, orgSlug, open }: OverlayProps<"deal">) {
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadDeal(db, orgId, orgSlug, open.id);
    if (!loaded) return null;
    const fctx = await formContext(db, orgId, shell.roles);
    const person = loaded.deal.primaryPersonId
      ? loaded.people.find((p) => p.person.id === loaded.deal.primaryPersonId)?.person.name
      : null;
    const form = await withRelationLabels(
      db,
      orgId,
      dealForm(
        { ...loaded.deal, personName: person ?? null },
        loaded.deal.pipeline,
        loaded.fields,
        fctx,
      ),
    );
    return { ...loaded, form, timelineItems: await presentTimeline(db, orgId, loaded.timeline) };
  });
  if (!data) return <RecordCard orgId={orgId} orgSlug={orgSlug} data={null} />;
  const { deal } = data;
  const stages = new Map(deal.pipeline.stages.map((s) => [s.id, s.name]));
  const card: RecordCardData = {
    kind: "deal",
    id: deal.id,
    name: deal.title,
    subtitle: [deal.stage.name, deal.pipeline.name, deal.company?.name].filter(Boolean).join(", "),
    deleted: Boolean(deal.deletedAt),
    facts: [
      ...(deal.amountCents !== null
        ? [{ label: "Amount", value: formatMoney(deal.amountCents, deal.currency) }]
        : []),
      { label: "Owner", value: ownerLabel(deal, shell.roles, names) ?? "Nobody" },
      ...(deal.nextStep ? [{ label: "Next step", value: deal.nextStep }] : []),
    ],
    people: data.people.map((p) => ({
      id: p.person.id,
      name: p.person.name,
      sub: p.role ?? p.person.title,
    })),
    deals: [],
    company: deal.company ? { id: deal.company.id, name: deal.company.name } : null,
    form: data.form,
    timeline: data.timelineItems,
    history: presentHistory(data.history, "deal", data.fields, names, stages),
    members: Object.fromEntries(names),
  };
  return <RecordCard orgId={orgId} orgSlug={orgSlug} data={card} />;
}
