import { Loader2 } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowLeft, ArrowRight } from "@/components/brand/arrows";
import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

/*
 * The onboarding step screen, one layout for every step, in the home page's
 * look (Graphite, Geist headlines, ink pills for actions): a top bar
 * with the logo and what's being set up, and one card holding the step.
 * Where a picture helps (the event calendar), the picture is the editor
 * itself, inside the step.
 */

/** The page: top bar, stepper, then the card. */
export function SetupShell({
  subject,
  exit,
  children,
}: {
  /** "Setting up {subject}"; none on a page that isn't a step (the start). */
  subject?: string;
  /** The top bar's right-hand action (Save and exit, Sign out). */
  exit: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 pb-5 sm:px-6">
      <header className="flex h-[72px] w-full flex-none items-center justify-between gap-4 sm:px-4 lg:px-10">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="text-foreground" data-plain>
            <Logo size={26} textSize={19} />
          </Link>
          {subject && (
            <span className="text-muted-foreground ml-1.5 hidden truncate text-[14px] sm:inline">
              Setting up {subject}
            </span>
          )}
        </div>
        {exit}
      </header>
      {children}
    </div>
  );
}

/** "Save and exit" / "Sign out": 14px, semibold, muted. */
export const exitClass =
  "text-muted-foreground hover:text-foreground cursor-pointer border-none bg-transparent p-0 text-[14px] font-semibold";

/** The step's card: one clean column, nothing beside or above the step. */
export function SetupCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-card text-card-foreground edge ring-foreground/6 rounded-shell flex w-full max-w-[640px] flex-col p-2.5 ring-1">
      <div className="flex min-w-0 flex-1 flex-col px-4 pt-6 pb-4 sm:px-8 sm:pt-7 sm:pb-5">
        {children}
      </div>
    </div>
  );
}

/** The question and the line under it. No step counts: onboarding is short, so it doesn't count. */
export function StepIntro({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="page-title m-0 text-[34px] sm:text-[40px]">{title}</h1>
      {children && (
        <p className="text-muted-foreground m-0 max-w-[440px] text-[15px] leading-[1.55]">
          {children}
        </p>
      )}
    </div>
  );
}

/** The step's fields, 22px under the intro. */
export function StepBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-[22px] flex flex-col gap-2", className)}>{children}</div>;
}

const footerTextButton =
  "text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-[15px] font-semibold disabled:cursor-default disabled:opacity-60";

/**
 * Back (an arrow and the word) on the left; Skip and the Continue pill on
 * the right. Back is a link or a button; Skip shows only when given.
 */
export function StepFooter({
  back,
  skip,
  children,
}: {
  back?: { href: string } | { onClick: () => void; disabled?: boolean };
  skip?: { onClick: () => void; disabled?: boolean; label?: string };
  /** The primary action (ContinuePill). */
  children: ReactNode;
}) {
  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-5">
      {back ? (
        "href" in back ? (
          <Link href={back.href} className={cn(footerTextButton, "text-muted-foreground")}>
            <ArrowLeft />
            Back
          </Link>
        ) : (
          <button
            type="button"
            onClick={back.onClick}
            disabled={back.disabled}
            className={footerTextButton}
          >
            <ArrowLeft />
            Back
          </button>
        )
      ) : (
        <span />
      )}
      <div className="flex items-center gap-5">
        {skip && (
          <button
            type="button"
            onClick={skip.onClick}
            disabled={skip.disabled}
            className={footerTextButton}
          >
            {skip.label ?? "Skip"}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** The Continue pill's look, for a link that moves on (a step with nothing to save). */
export const continueLinkClass = pill({ size: "md" });

/** Continue: the ink pill with its arrow; a spinner while the step saves. */
export function ContinuePill({
  pending = false,
  disabled,
  onClick,
  type = "button",
  pendingLabel = "Saving…",
  children = "Continue",
  style,
}: {
  pending?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  pendingLabel?: string;
  children?: ReactNode;
  /** A colour of its own (the theme step paints it in the picked theme). */
  style?: React.CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending || disabled}
      style={style}
      className={continueLinkClass}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRight />
        </>
      )}
    </button>
  );
}

/** A form-level error in a step. */
export function StepError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="bg-tint-danger text-tint-danger-foreground rounded-field m-0 mt-3 px-3.5 py-2.5 text-[14px]"
    >
      {message}
    </p>
  );
}
