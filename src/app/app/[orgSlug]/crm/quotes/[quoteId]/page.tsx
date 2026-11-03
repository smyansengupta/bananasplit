import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { QuoteEditor, type QuoteView } from "@/components/crm/quotes/quote-editor";
import { PageHeader } from "@/components/page-header";
import { readAddOns } from "@/lib/addons";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { effectiveStatus, KIND_WORD, type QuoteKind } from "@/lib/crm/quotes";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Quote" };

export default async function CrmQuotePage({ params }: PageProps<"/app/[orgSlug]/crm/quotes/[quoteId]">) {
  const { orgSlug, quoteId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const q = await db.crmQuote.findFirst({
      where: { id: quoteId, organizationId: orgId },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        deal: { select: { id: true, title: true, stage: { select: { kind: true } } } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!q) return null;
    const person = q.personId
      ? await db.crmPerson.findFirst({ where: { id: q.personId, organizationId: orgId }, select: { id: true, name: true, primaryEmail: true } })
      : null;
    const settings = await db.orgSettings.findUnique({ where: { organizationId: orgId }, select: { addOns: true } });
    return { q, person, financeAdded: readAddOns(settings?.addOns).includes("finance") };
  });
  if (!data) notFound();
  const { q, person } = data;
  const kind: QuoteKind = q.kind === "invoice" ? "invoice" : "quote";
  const view: QuoteView = {
    id: q.id,
    kind,
    number: q.number,
    title: q.title,
    status: effectiveStatus({ status: q.status, validUntil: q.validUntil }),
    currency: q.currency,
    notes: q.notes,
    validUntil: q.validUntil?.toISOString() ?? null,
    taxBps: q.taxBps,
    lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitCents: l.unitCents })),
    deal: q.deal ? { id: q.deal.id, title: q.deal.title, won: q.deal.stage.kind === "WON" } : null,
    company: q.company,
    person: person ? { id: person.id, name: person.name, email: person.primaryEmail } : null,
    sentAt: q.sentAt?.toISOString() ?? null,
    acceptedName: q.acceptedName,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
    declinedAt: q.declinedAt?.toISOString() ?? null,
    declineReason: q.declineReason,
    paidAt: q.paidAt?.toISOString() ?? null,
    booked: Boolean(q.financeTransactionId),
  };
  const canBook =
    data.financeAdded && spaceIncludes(shell.org, "finance") && can({ role: shell.role }, "finance.manage") && !q.financeTransactionId;
  return (
    <div className="space-y-6">
      <CrmTabs tabs={shell.tabs} />
      <BackLink href={`/app/${orgSlug}/crm/quotes`} label="Quotes" />
      <PageHeader title={`${KIND_WORD[kind].title} ${q.number}`} />
      <QuoteEditor orgId={orgId} orgSlug={orgSlug} quote={view} canBook={canBook} />
    </div>
  );
}
