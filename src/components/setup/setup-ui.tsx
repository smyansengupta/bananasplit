"use client";

import { AlertTriangle, Check, CircleDashed, Copy, RefreshCw, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

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

/** Muted for a neutral state, destructive for broken, success for working. */
function toneOf(status: SetupStepStatus): string {
  if (status === "connected") return "text-success";
  if (status === "error" || status === "needs_reauth") return "text-destructive";
  return "text-muted-foreground";
}

/**
 * The spine marker. Shows the step's ordinal until it is decided, then the
 * shape that names its state, so the rail reads at a glance.
 */
export function StepMarker({
  status,
  ordinal,
  active,
}: {
  status: SetupStepStatus;
  ordinal: number;
  active: boolean;
}) {
  const base =
    "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums transition-colors";
  if (status === "connected") {
    return (
      <span className={cn(base, "border-success bg-success text-success-foreground")}>
        <Check className="size-3.5" aria-hidden="true" strokeWidth={3} />
      </span>
    );
  }
  if (status === "error" || status === "needs_reauth") {
    return (
      <span className={cn(base, "border-destructive text-destructive")}>
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className={cn(base, "text-muted-foreground border-dashed")}>
        <CircleDashed className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        active ? "border-primary text-primary" : "text-muted-foreground border-border",
      )}
    >
      {ordinal}
    </span>
  );
}

export function StatusWord({ status, className }: { status: SetupStepStatus; className?: string }) {
  return <span className={cn("text-xs", toneOf(status), className)}>{STATUS_WORD[status]}</span>;
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
    <section className={cn("space-y-2", className)}>
      <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
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
    <div className="bg-muted/40 space-y-2 rounded-lg border p-4">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
        <ShieldAlert className="text-muted-foreground size-3.5" aria-hidden="true" />
        What you&apos;re agreeing to
      </p>
      <ul className="text-muted-foreground space-y-1.5 text-sm">
        {items.map((item) => (
          <li
            key={item}
            className="before:text-border relative pl-4 before:absolute before:left-0 before:content-['—']"
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
    <p className="border-warning/40 bg-warning/10 flex gap-2 rounded-lg border p-3 text-sm">
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
      className="border-destructive/40 bg-destructive/5 space-y-2 rounded-lg border p-3 text-sm"
    >
      <p className="text-destructive font-medium">{reason}</p>
      {fix ? <p className="text-foreground/80">{fix}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="text-foreground hover:bg-muted focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
        >
          <RefreshCw
            className={cn("size-3.5", retrying && "motion-safe:animate-spin")}
            aria-hidden="true"
          />
          {retrying ? "Testing…" : "Test again"}
        </button>
      ) : null}
    </div>
  );
}

/** Progress as a fraction, not a percentage nobody asked for. */
export function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-success h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{label}</p>
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
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={item.text} className="flex gap-3">
          <span className="bg-muted text-muted-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
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
    <div className="bg-muted/60 flex items-start gap-2 rounded-md border p-2">
      <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all">{value}</code>
      <button
        type="button"
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
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 rounded p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {copied ? (
          <Check className="text-success size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
