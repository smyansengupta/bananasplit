import { ArrowRight, Check, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The onboarding card: an icon badge, the step counter and a segmented
 * progress bar, the title and the fields. Every colour is a theme token, so
 * it matches the rest of the app in light and dark. Sign out sits in the
 * corner, since onboarding has no org shell and so no user menu.
 */

export function OnboardingFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-svh flex-1 flex-col items-center justify-center px-4 pt-14 pb-10 sm:py-16">
      <SignOutButton className="absolute top-3 right-3 sm:top-4 sm:right-4" />
      <div className={cn("relative w-full space-y-4", wide ? "max-w-xl" : "max-w-md")}>{children}</div>
    </div>
  );
}

export function ProgressSegments({
  total,
  done,
  tone = "primary",
}: {
  total: number;
  /** Segments filled in, including the current one. */
  done: number;
  tone?: "primary" | "warning";
}) {
  return (
    <div
      className="flex gap-1"
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
            "h-1 flex-1 rounded-full transition-colors duration-500",
            i < done ? (tone === "warning" ? "bg-warning" : "bg-primary") : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

export function StepCard({
  icon: Icon,
  step,
  tone = "primary",
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  /** Progress through the flow, when the card is one of its numbered steps. */
  step?: { index: number; total: number };
  tone?: "primary" | "warning";
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "bg-card text-card-foreground animate-in fade-in-0 slide-in-from-bottom-2 space-y-5 rounded-2xl border p-5 shadow-sm duration-500 sm:p-7",
        className,
      )}
    >
      {step && <ProgressSegments total={step.total} done={step.index} tone={tone} />}
      <header className="flex items-start gap-3.5">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
            tone === "warning" ? "bg-warning/10 text-warning ring-warning/20" : "bg-primary/10 text-primary ring-primary/15",
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="heading text-xl">{title}</h1>
            {step && (
              <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                {step.index} / {step.total}
              </span>
            )}
          </div>
          {description && <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** A field label with an optional icon and hint on the right. */
export function FieldLabel({
  htmlFor,
  id,
  icon: Icon,
  children,
  aside,
}: {
  htmlFor?: string;
  id?: string;
  icon?: LucideIcon;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <div className="flex items-center justify-between gap-2">
      <Tag htmlFor={htmlFor} id={id} className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="text-muted-foreground size-3.5" aria-hidden="true" />}
        {children}
      </Tag>
      {aside && <span className="text-muted-foreground font-mono text-[11px] tabular-nums">{aside}</span>}
    </div>
  );
}

/** A toggle pill (pronouns, grad year, days). Selected shows a check. */
export function Chip({
  selected,
  onClick,
  children,
  shape = "pill",
  className,
  disabled,
  icon: Icon,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  shape?: "pill" | "box";
  className?: string;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "focus-visible:ring-ring/50 inline-flex items-center justify-center gap-1.5 border text-sm transition-all outline-none focus-visible:ring-3 active:scale-[0.97] disabled:opacity-50",
        shape === "pill" ? "rounded-full px-3 py-1.5" : "rounded-lg px-2 py-2",
        selected
          ? "border-primary bg-primary text-primary-foreground font-medium shadow-sm"
          : "bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground",
        className,
      )}
    >
      {selected ? (
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      ) : (
        Icon && <Icon className="size-3.5" aria-hidden="true" />
      )}
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
  icon: Icon,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** The big "Join with invite code" / "Create an organization" choices. */
export const choiceTileClass =
  "group focus-visible:ring-ring/50 flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-all outline-none hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm focus-visible:ring-3";

export function ChoiceTileBody({
  icon: Icon,
  title,
  detail,
  primary = false,
  accentStyle,
}: {
  icon: LucideIcon;
  title: ReactNode;
  detail: ReactNode;
  primary?: boolean;
  /** The member's picked theme colours, on the primary choice. */
  accentStyle?: React.CSSProperties;
}) {
  return (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          primary ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
        style={primary ? accentStyle : undefined}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground block text-xs leading-snug">{detail}</span>
      </span>
      <ArrowRight
        className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </>
  );
}

/** The primary "Continue" of an org-setup step, with a spinner while it saves. */
export function ContinueButton({
  pending,
  disabled,
  onClick,
  children = "Continue",
  pendingLabel = "Saving…",
  icon: Icon = ArrowRight,
  className,
}: {
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
  pendingLabel?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="lg"
      className={cn("group flex-1 font-semibold", className)}
      onClick={onClick}
      disabled={pending || disabled}
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          <Icon className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </>
      )}
    </Button>
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
