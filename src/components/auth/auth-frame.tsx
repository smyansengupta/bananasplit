import Link from "next/link";

import { BananasplitMark } from "@/components/bananasplit-mark";
import { RegistrationMark, SplitWordmark } from "@/components/print-marks";

/**
 * The sign-in and sign-up pages: from lg up, a poster printed in the
 * primary ink beside the form; on smaller screens, the logo above it.
 * The form sits inside printer's crop marks. Public pages use the default
 * theme, so the poster is always Bananasplit's own two inks.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="bg-primary text-primary-foreground paper relative isolate hidden flex-col justify-between gap-10 overflow-hidden p-10 lg:flex">
        <div className="flex items-start justify-between gap-4">
          {/* On the primary ink, the app icon's inking: an accent banana, a paper split. */}
          <BananasplitMark className="size-16 [--mark-top:var(--brand-accent)] [--mark-under:var(--primary-foreground)]" />
          <RegistrationMark className="text-primary-foreground/70" />
        </div>
        <Link
          href="/"
          className="focus-visible:ring-primary-foreground w-fit rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <SplitWordmark className="text-[min(calc((50vw-5rem)/6.6),9rem)]" />
        </Link>
        <p className="max-w-sm text-lg leading-relaxed text-balance">
          Tasks, notes, meetings and money for your club&apos;s executive board, in one place.
        </p>
      </aside>

      <div className="relative isolate flex flex-col items-center justify-center gap-10 px-6 py-12 sm:px-10">
        <Link
          href="/"
          className="text-primary focus-visible:ring-ring flex items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:outline-none lg:hidden"
        >
          <BananasplitMark className="size-22" />
          <SplitWordmark className="text-[2.75rem]" />
        </Link>
        <div className="crop-marks reveal w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
