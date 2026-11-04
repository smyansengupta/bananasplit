import { DealCard, type DealCardData, type DealQuoteView } from "@/components/crm/cards/deal-card";
import { dealTypeChoices, dealTypeField, dealTypeOf } from "@/lib/crm/deals-tab";
import { formatMoney } from "@/lib/crm/fields";
import { effectiveStatus, type QuoteKind } from "@/lib/crm/quotes";
import { dealForm, formContext, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { presentHistory, presentTimeline } from "@/server/crm/present";
import { loadDeal } from "@/server/crm/records";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";
import { crmMembers } from "@/app/app/[orgSlug]/crm/shell";

/**
 * A deal's card (?open=deal:<id>, ?tab=quote to open on its quote):
 * everything its header, stage pills and four tabs need, read as the
 * viewer in one transaction.
 */
export async function DealOverlay({ shell, orgSlug, open }: OverlayProps<"deal">) {
  const orgId = shell.org.id;
  const membersP = crmMembers(orgId);
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadDeal(db, orgId, orgSlug, open.id);
    if (!loaded) return null;
    const { deal } = loaded;
    const contact =
      loaded.people.find((p) => p.person.id === deal.primaryPersonId)?.person ??
      loaded.people[0]?.person ??
      null;
    const fctx = await formContext(db, orgId, shell.roles);
    const typeField = dealTypeField(loaded.fields);
    const form = await withRelationLabels(
      db,
      orgId,
      dealForm({ ...deal, personName: contact?.name ?? null }, deal.pipeline, loaded.fields, fctx),
    );
    const quotes = await db.crmQuote.findMany({
      where: { organizationId: orgId, dealId: deal.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    const quotePeople = new Map<string, { name: string; email: string | null }>();
    for (const id of new Set(quotes.map((q) => q.personId).filter((x): x is string => Boolean(x)))) {
      const p = await db.crmPerson.findFirst({
        where: { id, organizationId: orgId },
        select: { name: true, primaryEmail: true },
      });
      if (p) quotePeople.set(id, { name: p.name, email: p.primaryEmail });
    }
    return {
      loaded,
      contact,
      form,
      typeField,
      quotes,
      quotePeople,
      timelineItems: await presentTimeline(db, orgId, loaded.timeline),
    };
  });
  if (!data) return <DealCard orgId={orgId} orgSlug={orgSlug} data={null} />;
  const names = new Map((await membersP).map((m) => [m.id, m.name]));
  const { deal } = data.loaded;
  const stages = new Map(deal.pipeline.stages.map((s) => [s.id, s.name]));
  const toView = (q: (typeof data.quotes)[number]): DealQuoteView => {
    const to = q.personId ? data.quotePeople.get(q.personId) : null;
    return {
      id: q.id,
      kind: (q.kind === "invoice" ? "invoice" : "quote") as QuoteKind,
      number: q.number,
      title: q.title,
      status: effectiveStatus({ status: q.status, validUntil: q.validUntil }),
      currency: q.currency,
      taxBps: q.taxBps,
      totalCents: q.totalCents,
      lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitCents: l.unitCents })),
      to: to ? { name: to.name, email: to.email } : null,
      sentAt: q.sentAt?.toISOString() ?? null,
      acceptedName: q.acceptedName,
      paidAt: q.paidAt?.toISOString() ?? null,
    };
  };
  const quote = data.quotes.find((q) => q.kind !== "invoice");
  const invoice = data.quotes.find((q) => q.kind === "invoice");
  const card: DealCardData = {
    id: deal.id,
    title: deal.title,
    deleted: Boolean(deal.deletedAt),
    company: deal.company ? { id: deal.company.id, name: deal.company.name } : null,
    amount: deal.amountCents !== null ? formatMoney(deal.amountCents, deal.currency) : null,
    hasAmount: deal.pipeline.hasAmount,
    type: dealTypeOf(data.typeField, deal.custom),
    typeChoices: dealTypeChoices(data.typeField),
    canAddTypes: shell.access.manager,
    typeFieldId: data.typeField?.id ?? null,
    stageId: deal.stageId,
    stages: deal.pipeline.stages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      requiredFields: s.requiredFields,
    })),
    wonLabel: deal.pipeline.wonLabel,
    lostLabel: deal.pipeline.lostLabel,
    closeReason: deal.closeReason,
    nextStep: deal.nextStep,
    nextStepAt: deal.nextStepAt?.toISOString() ?? null,
    expectedOn: deal.expectedOn?.toISOString() ?? null,
    owner: ownerLabel(deal, shell.roles, names),
    personal: shell.access.personal,
    contact: data.contact ? { id: data.contact.id, name: data.contact.name } : null,
    finance: data.loaded.sponsorship
      ? `In Finance as a deal${data.loaded.sponsorship.budgetPeriod?.label ? `, ${data.loaded.sponsorship.budgetPeriod.label}` : ""}`
      : null,
    quote: quote ? toView(quote) : null,
    invoice: invoice ? toView(invoice) : null,
    // A Personal space has one owner: no Owner field or fact.
    form: shell.access.personal ? data.form.filter((f) => f.key !== "owner") : data.form,
    timeline: data.timelineItems,
    history: presentHistory(data.loaded.history, "deal", data.loaded.fields, names, stages),
    members: Object.fromEntries(names),
  };
  return <DealCard orgId={orgId} orgSlug={orgSlug} data={card} />;
}
