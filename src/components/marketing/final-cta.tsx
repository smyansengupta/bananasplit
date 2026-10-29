import Link from "next/link";

import { ArrowRight } from "@/components/brand/arrows";
import { cn } from "@/lib/utils";

import { DEMO_HREF, startHref, TRIAL_PROMISE } from "./links";
import { CONTAINER } from "./section-title";
import { SiteLink } from "./site-link";

/**
 * The closing panel: the banana yellow, lit from the top, one last headline
 * and the hero's two buttons word for word (the SaaS homepage report: long-page
 * readers convert here), over a giant wordmark in the logo's typeface that
 * the panel's bottom edge crops. Fixed brand colours (ink on banana), so it
 * reads the same in light and dark.
 */
export function FinalCta({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <section className={cn(CONTAINER, "pt-24 pb-24 sm:pt-32 sm:pb-32")}>
      <div className="bg-peel-center text-ink rounded-shell relative overflow-hidden">
        <div className="flex flex-col items-center gap-6 px-6 pt-[clamp(64px,9vw,112px)] text-center">
          <h2 className="display-title max-w-[760px] text-[clamp(36px,5vw,64px)] leading-[1.02] tracking-[-0.04em] text-balance">
            Running your organization shouldn&apos;t be bananas.
          </h2>
          <p className="text-bark-soft max-w-[480px] text-[17px] leading-[1.55]">
            Set up your workspace in minutes and bring the whole team in with one invite code.
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href={startHref(signedIn)}
                data-cta="get_started"
                data-cta-location="final"
                className="bg-ink text-cream hover:bg-ink-hover hover:text-cream shadow-cta-soft inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold whitespace-nowrap"
              >
                Get started free <ArrowRight />
              </Link>
              <SiteLink
                href={DEMO_HREF}
                data-cta="request_demo"
                data-cta-location="final"
                className="border-ink/25 text-ink hover:bg-ink/5 inline-flex h-12 items-center rounded-full border px-6 text-[15px] font-semibold whitespace-nowrap"
              >
                Request a demo
              </SiteLink>
            </div>
            {!signedIn && <p className="text-bark-soft text-[14px]">{TRIAL_PROMISE}</p>}
          </div>
          <div
            aria-hidden="true"
            className="font-logo mt-[clamp(32px,5vw,64px)] -mb-[0.12em] text-[clamp(56px,15.5vw,196px)] leading-[0.78] tracking-[-0.05em] whitespace-nowrap"
          >
            bananasplit
          </div>
        </div>
      </div>
    </section>
  );
}
