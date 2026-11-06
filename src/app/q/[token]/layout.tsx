import type { Metadata } from "next";

import { PublicOrgFrame } from "@/components/theme/public-org-frame";
import { KIND_WORD } from "@/lib/crm/quotes";

import { publicQuote } from "./load";

export async function generateMetadata({ params }: LayoutProps<"/q/[token]">): Promise<Metadata> {
  const { token } = await params;
  const found = await publicQuote(token);
  const title = found ? `${KIND_WORD[found.quote.kind].title} ${found.quote.number} from ${found.org?.name ?? "an organization"}` : "Quote";
  return { title, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** A quote's public page, in the organization's own theme and with its logo. */
export default async function PublicQuoteLayout({ params, children }: LayoutProps<"/q/[token]">) {
  const { token } = await params;
  const found = await publicQuote(token);
  return <PublicOrgFrame org={found?.org ?? null}>{children}</PublicOrgFrame>;
}
