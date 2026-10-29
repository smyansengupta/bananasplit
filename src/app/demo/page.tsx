import { Check } from "@/components/icons";
import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { CONTAINER, SectionTitle } from "@/components/marketing/section-title";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

import { shareMetadata } from "@/lib/metadata/share";

import { DemoForm } from "./demo-form";

// The drawn card beside this file, demo/opengraph-image.png.
export const metadata: Metadata = shareMetadata({
  title: "Request a demo",
  description: "A 15-minute walkthrough of Bananasplit, set up for your kind of team.",
});

const WHAT_YOU_GET = [
  "Set up for your kind of team",
  "How Bananasplit connects to the apps you use today",
  "A plan for moving your projects, docs and budget in",
  "Pricing for your team size, and a quote you can share",
] as const;

/**
 * Request a demo (the secondary call to action everywhere): why it's worth
 * the time on the left, a short form on the right (DemoForm), stacked on
 * phones.
 */
export default async function DemoPage() {
  const signedIn = Boolean(await getSession());
  return (
    <MarketingShell signedIn={signedIn}>
      <section
        className={cn(
          CONTAINER,
          "grid items-start gap-12 pt-[clamp(48px,7vw,96px)] pb-24 lg:grid-cols-[1fr_440px] lg:gap-20",
        )}
      >
        <div className="flex flex-col gap-6">
          <SectionTitle as="h1" className="text-[clamp(40px,5.6vw,68px)] leading-[1] text-balance">
            Get a 15-minute walkthrough.
          </SectionTitle>
          <p className="text-foreground/80 max-w-[520px] text-[18px] leading-[1.55] text-pretty">
            Tell us about your team. We&apos;ll show you how it would run on Bananasplit, on a quick
            call.
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {WHAT_YOU_GET.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[16px] leading-[1.5]">
                <Check className="mt-1 size-4 flex-none" strokeWidth={2.5} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-card edge rounded-card p-6 sm:p-8">
          <DemoForm />
        </div>
      </section>
    </MarketingShell>
  );
}
