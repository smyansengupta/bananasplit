import { Check, Loader2 } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowLeft, ArrowRight } from "@/components/brand/arrows";
import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

/*
 * The onboarding step screen (design: App screens, 05), one layout for every
 * step: a top bar with the logo and what's being set up, a stepper of named
 * steps, and a framed card holding the step on the left and a live preview
 * on the right. Steps swap the title, the body and the preview.
 *
 * Presentational only, so the client step forms render the card themselves
 * and keep their preview in step with what's typed.
 */

/** The page: top bar, stepper, then the card. */
export function SetupShell({
  subject,
  exit,
  steps,
  current,
  children,
}: {
  /** "Setting up {subject}". */
  subject: string;
  /** The top bar's right-hand action (Save and exit, Sign out). */
  exit: ReactNode;
  steps: readonly string[];
  /** 1-based. */
  current: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 pb-5 sm:px-6">
      <header className="flex h-[72px] w-full flex-none items-center justify-between gap-4 sm:px-4 lg:px-10">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="text-foreground" data-plain>
            <Logo size={26} textSize={19} />
          </Link>
          <span className="text-muted-foreground ml-1.5 hidden truncate text-[14px] sm:inline">
            Setting up {subject}
          </span>
        </div>
        {exit}
      </header>
      <SetupStepper steps={steps} current={current} />
      {children}
    </div>
  );
}

/** "Save and exit" / "Sign out": 14px, semibold, muted. */
export const exitClass =
  "text-muted-foreground hover:text-foreground cursor-pointer border-none bg-transparent p-0 text-[14px] font-semibold";

/**
 * Numbered steps joined by 1.5px lines (Moonstone tokens): done is the
 * primary with a check, the current one a ring and a bold label, the rest
 * a muted outline. Lines are filled up to the current step. Every label
 * shows from xl; below that only the current one, and none on a phone
 * (the card says "Step 5 of 8").
 */
export function SetupStepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol
      aria-label="Setup steps"
      className="m-0 flex w-full max-w-[1080px] list-none items-center gap-1.5 p-0 pt-2 pb-7 sm:gap-3"
    >
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const here = n === current;
        return (
          <li key={label} className="contents">
            <span
              aria-current={here ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-[14px] whitespace-nowrap",
                done && "text-muted-foreground font-semibold",
                here && "text-foreground font-bold",
                !done && !here && "text-muted-foreground font-medium",
              )}
            >
              <span
                className={cn(
                  "grid size-5 flex-none place-items-center rounded-full text-[11px] sm:size-6",
                  done && "bg-primary text-primary-foreground font-extrabold",
                  here && "bg-card border-foreground border-2 font-extrabold",
                  !done && !here && "border-foreground/22 text-muted-foreground border-[1.5px] font-bold",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3.5} aria-label="Done" /> : n}
              </span>
              <span className={cn(here ? "max-sm:sr-only" : "sr-only xl:not-sr-only")}>
                {label}
              </span>
            </span>
            {n < steps.length && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-[1.5px] min-w-1 flex-1 sm:min-w-4",
                  n < current ? "bg-primary" : "bg-foreground/15",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The framed card: a 12px paper frame, the step on the left and the 380px
 * sand preview on the right. Below lg the preview is hidden.
 */
export function SetupCard({ preview, children }: { preview?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-card text-card-foreground edge ring-foreground/6 rounded-shell flex w-full max-w-[1080px] gap-2.5 p-2.5 ring-1 lg:min-h-[640px]">
      <div className="flex min-w-0 flex-1 flex-col px-4 pt-6 pb-4 sm:px-8 sm:pt-7 sm:pb-5">
        {children}
      </div>
      {preview && (
        <aside
          aria-label="Preview"
          className="bg-muted glow-corner hidden w-[380px] flex-none flex-col gap-3 rounded-[calc(var(--radius-shell)-0.625rem)] p-6 lg:flex"
        >
          {preview}
        </aside>
      )}
    </div>
  );
}

/** "Step 3 of 6", the question in Young Serif, and the helper text. */
export function StepIntro({
  index,
  total,
  title,
  children,
}: {
  index: number;
  total: number;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-muted-foreground text-[13px] font-semibold">
        Step {index} of {total}
      </span>
      <h1 className="page-title m-0 text-[34px] sm:text-[40px]">
        {title}
      </h1>
      {children && (
        <p className="text-muted-foreground m-0 max-w-[440px] text-[15px] leading-[1.55]">{children}</p>
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

/** The ink Continue pill with its arrow; a spinner while the step saves. */
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
      className={pill({ size: "md" })}
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

/** The dashed "+ Add a label" / "+ Add a team" row under a list. */
export function AddRowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground flex h-12 w-full cursor-pointer items-center rounded-tile hatch bg-muted px-4 text-left text-[15px] font-semibold transition-colors"
    >
      + {children}
    </button>
  );
}

/** The × that removes a row; `label` names what it removes. */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground flex-none cursor-pointer border-none bg-transparent p-0 text-[18px] leading-none"
    >
      ×
    </button>
  );
}

/** Stand-in avatar colours for people in a preview. */
export const PREVIEW_AVATAR_TONES = ["bg-avatar-1", "bg-primary", "bg-avatar-3", "bg-avatar-4"] as const;

/** The preview's header: "Preview" and what it shows. */
export function PreviewHeader({ meta, label = "Preview" }: { meta?: ReactNode; label?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-[13px] font-semibold">{label}</span>
      {meta && <span className="text-muted-foreground text-[12px]">{meta}</span>}
    </div>
  );
}

/** A white card in the preview (a task, a team, a person). */
export function PreviewTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("bg-card shadow-e1 rounded-tile flex flex-col gap-2.5 p-3.5", className)}
    >
      {children}
    </div>
  );
}

/** An outlined chip with a colour dot: a label on a task. */
export function DotChip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="text-muted-foreground border-foreground/12 inline-flex min-w-0 items-center gap-1.5 rounded-full border px-[9px] py-[3px] text-[12px] font-semibold">
      <span className="size-[7px] flex-none rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{children}</span>
    </span>
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
