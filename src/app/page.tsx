import type { Metadata } from "next";

import { HomePage } from "@/components/marketing/home/home-page";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Bananasplit: The First Ambient Workplace",
  description:
    "Your team's work keeps itself up to date. Bananasplit listens where you already work, handles the busywork, and texts you only when something needs you.",
};

/**
 * The marketing home page: "The First Ambient Workplace"
 * (docs/AMBIENT-WORKPLACE.md), its sections in
 * src/components/marketing/home/home-page.tsx. Pricing and its questions
 * live on /pricing (in the nav).
 */
export default async function Home() {
  const signedIn = Boolean(await getSession());

  return (
    <MarketingShell signedIn={signedIn}>
      <HomePage signedIn={signedIn} />
    </MarketingShell>
  );
}
