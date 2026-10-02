import Link from "next/link";

import { RegistrationMark } from "@/components/print-marks";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { Button } from "@/components/ui/button";

/** Any unknown URL (and every notFound()): a misprint, in the default theme. */
export default function NotFound() {
  return (
    <PublicThemeRoot>
      <main className="reveal flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <RegistrationMark className="size-7" />
        <p className="eyebrow text-muted-foreground">Error 404 · Misprint</p>
        <p
          aria-hidden="true"
          className="numeral text-primary misregister text-[clamp(7rem,32vw,15rem)] leading-[0.8]"
        >
          404
        </p>
        <h1 className="page-title">This page didn&apos;t make it to print.</h1>
        <p className="text-muted-foreground max-w-sm text-balance">
          The link may be old, or the page may have moved. Check the address, or start again from
          the front page.
        </p>
        <Button asChild size="lg" className="mt-2">
          <Link href="/">Back to the front page</Link>
        </Button>
      </main>
    </PublicThemeRoot>
  );
}
