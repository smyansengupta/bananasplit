import Link from "next/link";

import { ArrowRight } from "@/components/brand/arrows";
import { pill } from "@/components/brand/pill";
import { accentScaleStyle, BRAND_ACCENT_SCALE } from "@/lib/theme/accent";
import { cn } from "@/lib/utils";

/**
 * The bottom of every public RSVP page: guests who liked it can make pages
 * like it for their own club. RSVP pages come with every club, the Free plan
 * included, so the one way in is signing up. A chrome-coloured card lit by
 * Bananasplit's own banana glow (it is Bananasplit's invitation, not the
 * club's) even on a themed club's page.
 */
export function HostYourOwn() {
  return (
    <aside
      aria-label="Make RSVP pages for your organization"
      className="mx-auto w-full max-w-[1120px] px-4 pb-10 sm:px-10"
      style={accentScaleStyle(BRAND_ACCENT_SCALE)}
    >
      <div className="bg-chrome text-chrome-foreground rounded-card shadow-e2 relative isolate overflow-hidden px-6 py-8 sm:px-10 sm:py-10">
        <div
          aria-hidden="true"
          className="absolute -top-1/2 -left-[10%] -z-10 h-[160%] w-[70%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-banana)_28%,transparent),transparent)]"
        />
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex flex-col gap-2.5">
            <h2 className="font-heading m-0 text-[clamp(26px,3.4vw,36px)] leading-[1.04] font-[640] tracking-[-0.03em] text-balance">
              Hosting something? Make a page like this one.
            </h2>
            <p className="text-chrome-foreground/70 m-0 max-w-[520px] text-[15px] leading-[1.55]">
              Sign-ups, QR check-in, invite links and a bring list come with every organization on
              Bananasplit, the Free plan included.
            </p>
          </div>
          <Link
            href="/sign-up"
            className={cn(
              pill({ size: "md" }),
              "bg-chrome-foreground text-chrome hover:bg-chrome-foreground/90 hover:text-chrome justify-between gap-4",
            )}
          >
            Make RSVP pages, free
            <ArrowRight />
          </Link>
        </div>
      </div>
    </aside>
  );
}
