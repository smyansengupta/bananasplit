import { Info, TriangleAlert } from "@/components/icons";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The import flow's surfaces (Moonstone). On its own page each step is a
 * card; inside the setup guide (already a card) it sits on that card's
 * space instead, so cards never nest.
 */
export function ImportPanel({
  embedded,
  children,
  className,
}: {
  embedded?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (embedded) return <div className={cn("space-y-5", className)}>{children}</div>;
  return <Card className={cn("gap-5 px-6", className)}>{children}</Card>;
}

/** An error said in the danger tint (no border). */
export function ErrorNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        "bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A heads-up: the muted tile with a warning-coloured icon. */
export function WarningNotice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("bg-muted/60 rounded-tile flex items-start gap-2.5 p-3 text-sm", className)}>
      <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** What the AI model said about the file, in the info tint. */
export function ReadNotes({ readBy, notes }: { readBy: string | null; notes: string[] }) {
  if (!readBy && notes.length === 0) return null;
  return (
    <div className="bg-tint-info text-tint-info-foreground rounded-tile space-y-1.5 p-3 text-sm">
      {readBy && <p className="font-semibold">Read by {readBy}</p>}
      {notes.map((n, i) => (
        <p key={i} className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {n}
        </p>
      ))}
    </div>
  );
}

/**
 * Progress through a long job (an import sent in parts): the part done in
 * the primary, what's still to go hatched (the "not yet" pattern).
 */
export function HatchProgress({
  done,
  total,
  label,
  className,
}: {
  done: number;
  total: number;
  label: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  return (
    <div className={cn("space-y-2", className)} aria-live="polite">
      <p className="text-sm font-medium tabular-nums">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="bg-muted hatch flex h-2.5 overflow-hidden rounded-full"
      >
        <span
          className="bg-primary h-full rounded-full transition-[width] duration-500 ease-(--ease-ink) motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
