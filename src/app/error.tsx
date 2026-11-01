"use client";

import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

/**
 * Anything outside an organization that failed to load (onboarding, an
 * invite, checkout, the marketing pages), in Bananasplit's own look like
 * the 404: try again, or start from the home page. Pages inside an
 * organization have their own (app/[orgSlug]/error.tsx).
 */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    // Not <BrandRoot>: it reads the request (the CSP nonce) and is a server
    // component, and an error page is a client one. Its frame is enough.
    <div data-look="graphite" className="brand flex min-h-svh flex-1 flex-col">
      <header className="flex h-[72px] items-center px-4 sm:px-6 lg:px-10">
        <Link href="/" className="logo-lockup" data-plain>
          <Logo />
        </Link>
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-24 text-center">
        <h1 className="display-title relative m-0 text-[clamp(30px,4vw,44px)] tracking-[-0.03em]">
          This page didn&apos;t load.
        </h1>
        {error.digest && (
          <p className="text-muted-foreground m-0 text-[15px]">
            Code <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => retry()} className={cn(pill(), "px-6")}>
            Try again
          </button>
          <Link href="/" className={cn(pill({ tone: "outline" }), "px-6")}>
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
