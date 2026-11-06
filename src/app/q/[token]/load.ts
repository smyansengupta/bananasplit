import { cache } from "react";

import { getPublicOrgTheme } from "@/lib/theme/loader";
import { loadPublicQuote } from "@/server/crm/quotes";

/**
 * The quote behind a public link, once per request (the layout and the page
 * both want it). The organization's branding is read only once the link
 * proves to be real, so a made-up link reveals nothing about anyone.
 */
export const publicQuote = cache(async (token: string) => {
  const quote = await loadPublicQuote(decodeURIComponent(token));
  if (!quote) return null;
  const org = await getPublicOrgTheme(quote.organizationId);
  return { quote, org };
});
