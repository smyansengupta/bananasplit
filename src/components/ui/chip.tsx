import { X } from "@/components/icons";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A tag (or project) chip: a 24px pill with a colour dot, the tag's colour
 * mixed into the theme's card colour behind ink text, so any tag colour sits
 * well in any theme. `color` is the tag's own (data, strict hex) or a theme
 * token such as "var(--chart-3)".
 */
export function TagChip({
  color,
  children,
  onRemove,
  removeLabel,
  className,
}: {
  color: string;
  children: ReactNode;
  onRemove?: () => void;
  /** e.g. "Remove tag Logistics"; required with onRemove. */
  removeLabel?: string;
  className?: string;
}) {
  return (
    <span
      style={{ "--tag": color } as CSSProperties}
      className={cn(
        "text-foreground inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--tag)_18%,var(--card))] px-2.5 text-xs font-semibold whitespace-nowrap",
        onRemove && "pr-1",
        className,
      )}
    >
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-(--tag)" />
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="hover:bg-foreground/10 grid size-5 shrink-0 place-items-center rounded-full"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/**
 * A status (or project) dot with its word: an 8px dot with a soft halo,
 * never on its own. `color` is a theme token or a project's own colour.
 */
export function StatusDot({
  color,
  children,
  className,
}: {
  color: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      style={{ "--dot": color } as CSSProperties}
      className={cn("inline-flex items-center gap-2 text-[13px] font-medium", className)}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-(--dot) shadow-[0_0_0_3px_color-mix(in_oklab,var(--dot)_24%,transparent)]"
      />
      {children}
    </span>
  );
}
