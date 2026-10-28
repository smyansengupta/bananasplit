import { ArrowRight, Check, type IconComponent } from "@/components/icons";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Field pieces for the profile-setup steps (and the profile page's theme
 * form): labels, toggle chips, the dashed "add" control, the "what's next"
 * choices and field errors. The step layout itself is setup-shell.tsx.
 */

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
  icon?: IconComponent;
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
      {aside && (
        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">{aside}</span>
      )}
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
  icon?: IconComponent;
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
  icon?: IconComponent;
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
}: {
  icon: IconComponent;
  title: ReactNode;
  detail: ReactNode;
  primary?: boolean;
}) {
  return (
    <>
      <Icon
        className={cn("size-5 shrink-0", primary ? "text-foreground" : "text-muted-foreground")}
        aria-hidden="true"
      />
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

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-destructive text-xs" role="alert">
      {message}
    </p>
  );
}
