"use client";

import { AlertTriangle, Check, CircleDashed, Copy, RefreshCw, ShieldAlert } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SetupStepStatus } from "@/server/setup/progress";

/**
 * The shared vocabulary of the guided setup: one status word, one marker
 * shape, one way of saying "here is what this costs you".
 *
 * Every colour is a theme token, so an org that restyles the suite restyles
 * the setup flow with it (theme/no-raw-colors is an error in .tsx).
 */

export const STATUS_WORD: Record<SetupStepStatus, string> = {
  connected: "Connected",
  error: "Not working",
  needs_reauth: "Needs reconnecting",
  untested: "Saved, untested",
  skipped: "Skipped",
  todo: "Not set up",
};

/** Success for working, destructive for broken, info for half-done, neutral otherwise. */
export function statusBadgeVariant(
  status: SetupStepStatus,
): "success" | "destructive" | "info" | "secondary" {
  if (status === "connected") return "success";
  if (status === "error" || status === "needs_reauth") return "destructive";
  if (status === "untested") return "info";
  return "secondary";
}

/** The step's state as a chip: "Connected", "Not working", "Skipped". */
export function StatusBadge({
  status,
  className,
}: {
  status: SetupStepStatus;
  className?: string;
}) {
  return (
    <Badge variant={statusBadgeVariant(status)} className={className}>
      {STATUS_WORD[status]}
    </Badge>
  );
}

/** Muted for a neutral state, destructive for broken, success for working. */
function toneOf(status: SetupStepStatus): string {
  if (status === "connected") return "text-success";
  if (status === "error" || status === "needs_reauth") return "text-destructive";
  return "text-muted-foreground";
}

/**
 * The spine marker: a filled circle. It shows the step's ordinal until the
 * step is decided, then the shape that names its state (a check on the goal
 * colour once it works), so the rail reads at a glance.
 */
export function StepMarker({
  status,
  ordinal,
  active,
  className,
}: {
  status: SetupStepStatus;
  ordinal: number;
  active: boolean;
  className?: string;
}) {
  const base =
    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors";
  if (status === "connected") {
    return (
      <span className={cn(base, "bg-block-goal text-block-goal-foreground", className)}>
        <Check className="size-4" aria-hidden="true" strokeWidth={2.75} />
      </span>
    );
  }
  if (status === "error" || status === "needs_reauth") {
    return (
      <span className={cn(base, "bg-tint-danger text-tint-danger-foreground", className)}>
        <AlertTriangle className="size-3.5" aria-hidden="true" strokeWidth={2.25} />
      </span>
    );
  }
  if (status === "skipped" && !active) {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground", className)}>
        <CircleDashed className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {ordinal}
    </span>
  );
}

export function StatusWord({ status, className }: { status: SetupStepStatus; className?: string }) {
  return (
    <span className={cn("text-[13px]", toneOf(status), className)}>{STATUS_WORD[status]}</span>
  );
}

/** A labelled block inside a step panel. More space above than below. */
export function PanelSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="heading text-[15px]">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What saying yes actually costs. Deliberately not collapsible: a
 * consequence behind a disclosure is a consequence nobody read.
 */
export function Consequences({ items }: { items: readonly string[] }) {
  return (
    <div className="rounded-tile bg-muted/60 space-y-2.5 p-4">
      <p className="heading flex items-center gap-2 text-sm">
        <ShieldAlert className="text-muted-foreground size-4" aria-hidden="true" />
        What you&apos;re agreeing to
      </p>
      <ul className="text-muted-foreground space-y-1.5 text-sm">
        {items.map((item) => (
          <li
            key={item}
            className="before:bg-muted-foreground/60 relative pl-4 before:absolute before:top-[0.6em] before:left-0.5 before:size-1.5 before:rounded-full"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What has to happen somewhere else before this step can work at all. */
export function Prerequisite({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-tile bg-muted/60 flex gap-2.5 p-3 text-sm">
      <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * A failed test: the service's own words, then the one thing to change.
 * `role="alert"` so a screen reader hears it when it replaces the button.
 */
export function FailureNote({
  reason,
  fix,
  onRetry,
  retrying,
}: {
  reason: string;
  fix?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-tile bg-tint-danger text-tint-danger-foreground space-y-1.5 p-3 text-sm"
    >
      <p className="font-semibold">{reason}</p>
      {fix ? <p>{fix}</p> : null}
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="mt-1"
        >
          <RefreshCw
            className={cn("size-3.5", retrying && "motion-safe:animate-spin")}
            aria-hidden="true"
          />
          {retrying ? "Testing…" : "Test again"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Progress as a fraction, not a percentage nobody asked for: one segment per
 * step, filled in the goal colour as each one connects.
 */
export function ProgressBar({
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
  const segments = Math.max(1, total);
  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
        className="flex h-2 gap-1"
      >
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-full transition-colors duration-500 motion-reduce:transition-none",
              i < done ? "bg-block-goal" : "bg-muted-strong",
            )}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-[13px]">{label}</p>
    </div>
  );
}

/**
 * Where the credential comes from, click by click. Numbered because the
 * order is the instruction: step 3 makes no sense before step 2.
 *
 * A `code` line is selectable and copyable — a student officer pasting a
 * SQL statement into Supabase should not be retyping it.
 */
export function ClickPath({ items }: { items: readonly { text: string; code?: string }[] }) {
  return (
    <ol className="space-y-3.5">
      {items.map((item, i) => (
        <li key={item.text} className="flex gap-3">
          <span className="bg-muted text-muted-foreground grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <p className="text-sm">{item.text}</p>
            {item.code ? <CopyLine value={item.code} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-field bg-muted/60 flex items-start gap-2 py-2 pr-2 pl-3.5">
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs leading-relaxed break-all">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => undefined,
          );
        }}
        className="text-muted-foreground shrink-0"
      >
        {copied ? (
          <Check className="text-success" aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
