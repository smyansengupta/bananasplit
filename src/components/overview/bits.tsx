import { ArrowUpRight } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { PersonFace } from "@/server/overview/queries";

/**
 * Small Overview pieces that work in server components (icon components are
 * rendered here, never passed as props to a client component):
 * the ↗ circle link, the count chip, tiles and their icon chip, and the
 * avatar stack.
 */

/** ↗: open the full page (an outline circle, 32px). */
export function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="icon-sm" className="shrink-0">
      <Link href={href} aria-label={label} title={label}>
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  );
}

/** A card header's controls: the count chip after the title, then ↗ on the far right. */
export function CardControls({
  count,
  chips,
  children,
}: {
  count?: ReactNode;
  /** More chips beside the count ("1 overdue"). */
  chips?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {count !== undefined && count !== null && <Badge variant="secondary">{count}</Badge>}
      {chips}
      <span className="flex-1" />
      {children}
    </>
  );
}

export const tileClass =
  "bg-muted/60 hover:bg-muted rounded-tile flex min-w-0 items-center gap-3 p-3.5 transition-colors";

/** The 36px icon circle at the start of a tile (the icon goes in as children). */
export function TileIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-card grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight),0_1px_2px_rgb(0_0_0/0.08)] [&_svg]:size-[18px]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A tile's two lines. */
export function TileText({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm leading-tight font-semibold">{title}</span>
      {sub && <span className="text-muted-foreground mt-0.5 block truncate text-[13px]">{sub}</span>}
    </span>
  );
}

/**
 * Overlapping faces: three, then "+N", each ringed in the surface colour
 * (`ring` names it: a block card passes its own via --ring-bg).
 */
export function FaceStack({
  people,
  total,
  className,
}: {
  people: readonly PersonFace[];
  /** Everyone counted; the rest show as "+N". */
  total?: number;
  className?: string;
}) {
  const shown = people.slice(0, 3);
  const more = Math.max(0, (total ?? people.length) - shown.length);
  if (shown.length === 0 && more === 0) return null;
  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((p, i) => (
        <UserAvatar
          key={p.id}
          user={p}
          size="md"
          className={cn("ring-2 ring-(--ring-bg,var(--card))", i > 0 && "-ml-2")}
        />
      ))}
      {more > 0 && (
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,currentColor_18%,var(--ring-bg,var(--card)))] text-xs font-bold ring-2 ring-(--ring-bg,var(--card))",
            shown.length > 0 && "-ml-2",
          )}
        >
          +{more}
        </span>
      )}
    </span>
  );
}
