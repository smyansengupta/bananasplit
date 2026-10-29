import type { Metadata } from "next";

import { Faq, type FaqItem } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { getSession } from "@/lib/auth/session";
import { shareMetadata } from "@/lib/metadata/share";

// The drawn card beside this file, pricing/opengraph-image.png.
export const metadata: Metadata = shareMetadata({
  title: "Pricing",
  description:
    "Every new team starts with 14 days of everything, free, no card. Free holds up to 10 members; Team and Team Advanced add finance, integrations, iMessage, reports and AI, with flat yearly prices for student organizations.",
});

const PRICING_FAQS: readonly FaqItem[] = [
  {
    q: "Do I need a credit card to start?",
    a: "No. Every new account gets 14 days of Personal Plus and every new team 14 days of Team Advanced, free, without a card. You only add one if you choose a paid plan.",
  },
  {
    q: "What happens when the free trial ends?",
    a: "We email you three days before it ends. After that you move to Free, which holds up to 10 members, or to the plan you picked during the trial. Picking a plan never cuts the trial short. Nothing is paused or deleted, and you can upgrade at any time.",
  },
  {
    q: "Who counts as a member?",
    a: "Anyone who joins your organization. Free holds up to 10; Team and Team Advanced have no limit. Guests who RSVP to an event or answer a poll never count and never need an account. On student plans, members never pay: the organization pays one flat price.",
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
