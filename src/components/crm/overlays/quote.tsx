import { QuoteCard } from "@/components/crm/cards/quote-card";
import type { QuoteView } from "@/components/crm/quotes/quote-editor";
import { readAddOns } from "@/lib/addons";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { effectiveStatus, type QuoteKind } from "@/lib/crm/quotes";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

/**
 * A quote or invoice with every detail (?open=quote:<id>): tax, notes,
 * dates, copy, make an invoice, move it to another deal, mark it paid.
 * A deal's quote is on its card's Quote tab; that tab's "All details"
 * opens this, and closing it goes back to the deal.
 */
export async function QuoteOverlay({ shell, orgSlug, open }: OverlayProps<"quote">) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const q = await db.crmQuote.findFirst({
      where: { id: open.id, organizationId: orgId },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        deal: { select: { id: true, title: true, stage: { select: { kind: true } } } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!q) return null;
    const person = q.personId
      ? await db.crmPerson.findFirst({
          where: { id: q.personId, organizationId: orgId },
          select: { id: true, name: true, primaryEmail: true },
        })
      : null;
    const settings = await db.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: { addOns: true },
    });
    return { q, person, financeAdded: readAddOns(settings?.addOns).includes("finance") };
  });
  if (!data) return <QuoteCard orgId={orgId} orgSlug={orgSlug} quote={null} canBook={false} />;
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
    data.financeAdded &&
    spaceIncludes(shell.org, "finance") &&
    can({ role: shell.role }, "finance.manage") &&
    !q.financeTransactionId;
  return <QuoteCard orgId={orgId} orgSlug={orgSlug} quote={view} canBook={canBook} />;
}
