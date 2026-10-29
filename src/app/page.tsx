import type { Metadata } from "next";

import { Security } from "@/components/marketing/connect";
import { Features } from "@/components/marketing/features";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { Integrations } from "@/components/marketing/integrations";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Solutions } from "@/components/marketing/solutions";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Bananasplit: the new era of team keeping",
  description:
    "Bananasplit brings your team's projects, docs, events and money into one smart workspace, and it works with the apps you already use.",
};

/**
 * The marketing home page, centred and laid out like Notion's, in Graphite
 * (light or dark), in the SaaS homepage report's section order: the hero
 * (headline, the two buttons, the risk remover, the real product, the apps
 * it works with), the features (a bento, a swipeable row on phones, most
 * important first: texting, projects, docs, events, calendar, finance, AI),
 * tabs by kind of organization, the one integrations section, a slim
 * security strip, and the final band repeating the hero's buttons. Pricing and its
 * questions live on /pricing (in the nav).
 */
export default async function Home() {
  const signedIn = Boolean(await getSession());

  return (
    <MarketingShell signedIn={signedIn}>
      <Hero signedIn={signedIn} />
      <Features />
      <Solutions signedIn={signedIn} />
      <Integrations />
      <Security />
      <FinalCta signedIn={signedIn} />
    </MarketingShell>
  );
}
