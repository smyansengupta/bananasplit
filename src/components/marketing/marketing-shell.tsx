import { CtaTracker } from "@/components/analytics/cta-tracker";
import { BrandRoot } from "@/components/brand/brand-root";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * A marketing page (the home page, /pricing): the Graphite look, light or
 * dark, with no glow, headlines in Geist (BrandRoot), and the header and
 * footer around it. `overflow-x-clip` keeps wide decoration from scrolling the page
 * sideways without breaking the sticky header, as `hidden` would.
 */
export function MarketingShell({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}) {
  return (
    <BrandRoot look="graphite" className="overflow-x-clip">
      <CtaTracker />
      <SiteHeader signedIn={signedIn} />
      <main id="top" className="flex flex-col">
        {children}
      </main>
      <SiteFooter signedIn={signedIn} />
    </BrandRoot>
  );
}
