import { notFound, redirect } from "next/navigation";

import { crmQuoteHref } from "@/lib/crm/href";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

/**
 * An old quote link: a quote with a deal opens the deal card's Quote tab,
 * one with no deal its own card over People (?open=quote:<id>). ?edit=1
 * (the Quote tab's old "All details") opens the quote's card either way.
 */
export default async function CrmQuotePage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/quotes/[quoteId]">) {
  const { orgSlug, quoteId } = await params;
  const sp = await searchParams;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const quote = await withOrgTx(orgId, ({ db }) =>
    db.crmQuote.findFirst({ where: { id: quoteId, organizationId: orgId }, select: { id: true, dealId: true } }),
  );
  if (!quote) notFound();
  redirect(
    sp.edit === "1"
      ? hrefWithOpen(`/app/${orgSlug}/crm/people`, "", { kind: "quote", id: quote.id })
      : crmQuoteHref(orgSlug, quote),
  );
}
