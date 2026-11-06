"use client";

import { ReceiptText } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CrmCard } from "@/components/crm/card/crm-card";
import { setPendingOpen } from "@/components/crm/card/use-crm-open";
import { QuoteEditor, type QuoteView } from "@/components/crm/quotes/quote-editor";
import { EmptyState } from "@/components/empty-state";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { KIND_WORD } from "@/lib/crm/quotes";

/**
 * A quote or invoice as a card (?open=quote:<id>), over whatever CRM page
 * you're on: the full editor (QuoteEditor) in the card's body. A deal's
 * quote closes back to the deal card's Quote tab; one with no deal closes
 * to the page underneath.
 */
export function QuoteCard({
  orgId,
  orgSlug,
  quote,
  canBook,
}: {
  orgId: string;
  orgSlug: string;
  quote: QuoteView | null;
  canBook: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const close = () => {
    const rest = new URLSearchParams(params.toString());
    if (quote?.deal) {
      rest.set("tab", "quote");
      // Back to the deal: its frame shows while it loads.
      setPendingOpen(`deal:${quote.deal.id}`);
      router.replace(hrefWithOpen(pathname, rest, { kind: "deal", id: quote.deal.id }), { scroll: false });
    } else {
      rest.delete("tab");
      router.replace(hrefWithOpen(pathname, rest, null), { scroll: false });
    }
  };
  if (!quote) {
    return (
      <CrmCard title="Not here">
        <EmptyState
          icon={ReceiptText}
          title="This quote isn't in the CRM any more"
          description="It may have been deleted, or you can't see it."
        />
      </CrmCard>
    );
  }
  const word = KIND_WORD[quote.kind];
  return (
    <CrmCard
      title={`${word.title} ${quote.number}`}
      subtitle={quote.title}
      description={`${word.title} ${quote.number}, every detail`}
      onClose={close}
    >
      <QuoteEditor
        orgId={orgId}
        orgSlug={orgSlug}
        quote={quote}
        canBook={canBook}
        onOpenQuote={(id) => router.push(hrefWithOpen(pathname, params, { kind: "quote", id }), { scroll: false })}
      />
    </CrmCard>
  );
}
