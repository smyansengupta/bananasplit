import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The onboarding card from the flowchart: a segmented progress bar with a
 * "2/6" counter, a step label above the card, the title and the fields.
 * Every colour is a theme token, so it matches the rest of the app in light
 * and dark.
 */

export function OnboardingFrame({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-svh flex-1 flex-col items-center px-4 py-10 sm:py-16">
      <div className={cn("w-full space-y-6", wide ? "max-w-xl" : "max-w-md")}>
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="Clubport home">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg text-sm font-bold">
            C
          </span>
          <span className="text-sm font-semibold tracking-tight">Clubport</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

export function ProgressSegments({
  total,
  done,
  tone = "primary",
  showCount = true,
}: {
  total: number;
  /** Segments filled in, including the current one. */
  done: number;
  tone?: "primary" | "warning";
  showCount?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex flex-1 gap-1"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`Step ${done} of ${total}`}
      >
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-[3px] flex-1 rounded-full transition-colors",
              i < done ? (tone === "warning" ? "bg-warning" : "bg-primary") : "bg-muted",
            )}
          />
        ))}
      </div>
      {showCount && (
        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
          {done}/{total}
        </span>
      )}
    </div>
  );
}

export function StepCard({
  label,
  hint,
  progress,
  title,
  description,
  children,
  className,
}: {
  /** "A1 · Basics": the flowchart's label above the card. */
  label: string;
  /** One line under the label. */
  hint?: ReactNode;
  progress?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="space-y-2.5">
      <div className="text-muted-foreground font-mono text-[11px] tracking-[0.08em] uppercase">
        {label}
      </div>
      {hint && <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>}
      <div
        className={cn(
          "bg-card text-card-foreground space-y-4 rounded-2xl border p-5 shadow-xs sm:p-6",
          className,
        )}
      >
        {progress}
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{description}</p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

/** A toggle pill (pronouns, grad year, tags). */
export function Chip({
  selected,
  onClick,
  children,
  shape = "pill",
  className,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  shape?: "pill" | "box";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "focus-visible:ring-ring/50 border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
        shape === "pill" ? "rounded-full" : "rounded-md py-1.5 text-center",
        selected
          ? "border-primary bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** "+ Add link" style dashed control. */
export function DashedButton({
  onClick,
  children,
  className,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-primary hover:bg-primary/5 focus-visible:ring-ring/50 rounded-lg border border-dashed px-3 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-destructive text-xs" role="alert">
      {message}
    </p>
  );
}
