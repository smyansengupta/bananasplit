import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { CoreMark, Logo } from "./logo";

/**
 * The card behind sign-in, sign-up, password help and joining a club
 * (Moonstone): a 1000px card on the page, its 10px frame around a graphite
 * panel on the left (the chrome colour, dark in both modes, lit by the
 * the logo at the top, `panel` at the bottom,
 * a faint outline of the mark bleeding off the corner) and the form on the
 * right. Below lg the panel is hidden and the logo sits above the form.
 * `footer` closes the form column: the pages a signed-in person reaches pass
 * <SignedInAs /> (a server component, so it can't be imported here: client
 * forms import AuthTitle from this file).
 */
export function AuthCard({
  panel = <AuthHeadline />,
  children,
  tall = false,
  formClassName,
  footer,
}: {
  /** The bottom of the panel; the tagline when not given. */
  panel?: ReactNode;
  children: ReactNode;
  /** Sign-up's taller card (660px instead of 620px). */
  tall?: boolean;
  /** The form column's padding and gap, when a screen differs. */
  formClassName?: string;
  /** Under the form: the "Signed in as … Sign out" line. */
  footer?: ReactNode;
}) {
  return (
    <main className="grid flex-1 grid-cols-1 place-items-center px-4 py-8 sm:px-6 sm:py-12">
      <div
        className={cn(
          "bg-card text-card-foreground edge ring-foreground/6 rounded-shell flex w-full max-w-[1000px] gap-2.5 p-2.5 ring-1",
          tall ? "lg:min-h-[660px]" : "lg:min-h-[620px]",
        )}
      >
        <div className="bg-chrome text-chrome-foreground relative hidden w-[420px] flex-none flex-col justify-between overflow-hidden rounded-[calc(var(--radius-shell)-0.625rem)] p-10 lg:flex">
          <CoreMark
            size={420}
            tone="outline"
            className="pointer-events-none absolute -right-[130px] -bottom-[120px] opacity-[0.07]"
          />
          <Link href="/" className="text-logo-cream relative w-fit" data-plain>
            <Logo />
          </Link>
          <div className="relative">{panel}</div>
        </div>
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center gap-5 px-3.5 py-7 sm:px-10 lg:px-16 lg:py-10",
            formClassName,
          )}
        >
          <Link href="/" className="logo-lockup w-fit lg:hidden" data-plain>
            <Logo />
          </Link>
          {children}
          {footer}
        </div>
      </div>
    </main>
  );
}

/** The panel's headline (the tagline unless given): the display face, set tight. */
export function AuthHeadline({
  children = <>The new era of team keeping.</>,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn("display-title m-0 text-[46px] leading-[1.02] tracking-[-0.035em]", className)}
    >
      {children}
    </p>
  );
}

/** The form's title and the line under it. `eyebrow`: a small muted label above. */
export function AuthTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {eyebrow && <span className="eyebrow text-muted-foreground">{eyebrow}</span>}
      <h1 className="display-title m-0 text-[clamp(30px,3vw,36px)] tracking-[-0.03em]">{title}</h1>
      {description && (
        <p className="text-muted-foreground m-0 text-[15px] leading-[1.55] text-pretty">
          {description}
        </p>
      )}
    </div>
  );
}
