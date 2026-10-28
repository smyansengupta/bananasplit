import Link from "next/link";

import { SignOutLink } from "@/components/auth/sign-out-link";
import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

import { NAV, PRIMARY_CTA_SM, startHref } from "./links";

/**
 * The bar across the top of the marketing pages: frosted over whatever
 * scrolls beneath, a hairline under it. The logo, five sections, then Log in
 * (a quiet link) and the primary button, which repeats the hero's. Below md the sections drop out. Signed in, the
 * button opens the app and Log in becomes Sign out.
 */
export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="border-border/70 bg-background/75 sticky top-0 z-30 border-b backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-6 lg:gap-8">
        <Link href="/" className="logo-lockup flex" aria-label="Bananasplit home" data-plain>
          <Logo size={24} textSize={18} wordmarkClassName="hidden min-[400px]:inline" />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 gap-0.5 text-[14px] font-medium lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full px-3 py-2 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          {signedIn ? (
            <>
              <SignOutLink
                className={cn(pill({ tone: "outline", size: "md" }), "border-transparent")}
              />
              <Link href="/app" className={PRIMARY_CTA_SM}>
                Open Bananasplit
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-muted-foreground hover:text-foreground px-3 text-[14px] font-medium whitespace-nowrap transition-colors"
              >
                Log in
              </Link>
              <Link
                href={startHref(false)}
                className={PRIMARY_CTA_SM}
                data-cta="get_started"
                data-cta-location="header"
              >
                Get started free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
