import type { Metadata } from "next";

import { Faq, type FaqItem } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Pricing: Bananasplit",
  description:
    "Free for teams of any size. Team and Team Advanced add finance, reports and AI, with flat yearly prices for student organizations.",
};

const PRICING_FAQS: readonly FaqItem[] = [
  {
    q: "What happens when the free trial ends?",
    a: "Every new team gets 30 days of Team Advanced. After that it moves to Free unless you pick a paid plan. Nothing is paused or deleted, and you can upgrade at any time.",
  },
  {
    q: "Who counts as a member?",
    a: "Anyone who joins your organization. Guests who RSVP to an event or answer a poll never count and never need an account. On student plans, members never pay: the organization pays one flat price.",
  },
  {
    q: "Who qualifies for student pricing?",
    a: "Student organizations whose owner has a verified school email, up to 100 members on Team and 300 on Team Advanced. Student prices are for student organizations, not businesses.",
  },
  {
    q: "How is billing handled?",
    a: "Standard plans are billed yearly per member. Student plans are billed per academic year, August to May, or per semester. You can pay by card or by purchase order.",
  },
  {
    q: "Can we license every team at once?",
    a: "Yes. Custom covers every team under one contract, with admin controls, invoicing and a security review. Schools can put every student organization on Team Advanced.",
  },
  {
    q: "Can we leave whenever we want?",
    a: "Yes. Cancel any time, and export your docs, data and finances as Word, PDF, Markdown or CSV whenever you like.",
  },
];

/** The pricing page: the plans and the comparison, then billing questions and the last call. */
export default async function PricingPage() {
  const signedIn = Boolean(await getSession());

  return (
    <MarketingShell signedIn={signedIn}>
      <PricingPlans signedIn={signedIn} />
      <Faq items={PRICING_FAQS} title="Billing questions." />
      <FinalCta signedIn={signedIn} />
    </MarketingShell>
  );
}
