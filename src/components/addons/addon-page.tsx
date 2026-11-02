import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowRight, ChevronLeft } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The pieces an add-on's page is made of (Integrations and apps › Forms,
 * Finance, CRM): its header, a big preview beside "At a glance", then one
 * card per feature, the exact details on one side and a small preview of
 * it working on the other. Server-safe, no hooks.
 */

/**
 * Soft tints. Amber and pink have no light-mode token, so they're mixed from
 * the chart colours; dark mode uses the dark palette's own amber and pink
 * (the avatar tints), which are made for its dark surfaces.
 */
export const TINT = {
  info: "bg-tint-info text-tint-info-foreground",
  success: "bg-tint-success text-tint-success-foreground",
  danger: "bg-tint-danger text-tint-danger-foreground",
  amber:
    "bg-[color-mix(in_oklab,var(--chart-4)_16%,var(--card))] text-[color-mix(in_oklab,var(--chart-4)_62%,var(--foreground))] dark:bg-avatar-4 dark:text-avatar-4-foreground",
  pink: "bg-[color-mix(in_oklab,var(--chart-5)_16%,var(--card))] text-[color-mix(in_oklab,var(--chart-5)_62%,var(--foreground))] dark:bg-avatar-5 dark:text-avatar-5-foreground",
  muted: "bg-muted text-muted-foreground",
} as const;
export type Tint = keyof typeof TINT;

/** The panel colour behind a preview (no text colour). */
export const PANEL: Record<Tint | "tile", string> = {
  info: "bg-tint-info",
  success: "bg-tint-success",
  danger: "bg-tint-danger",
  amber: "bg-[color-mix(in_oklab,var(--chart-4)_16%,var(--card))] dark:bg-avatar-4",
  pink: "bg-[color-mix(in_oklab,var(--chart-5)_16%,var(--card))] dark:bg-avatar-5",
  muted: "bg-muted",
  tile: "bg-muted/55",
};

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-[13.5px] font-semibold"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  );
}

export function AddOnHeader({
  icon,
  tint,
  name,
  status,
  summary,
  action,
}: {
  icon: ReactNode;
  tint: Tint;
  name: string;
  status: ReactNode;
  summary: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-[18px]">
      <span
        className={cn("grid size-[60px] shrink-0 place-items-center rounded-[18px]", TINT[tint])}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{name}</h1>
          {status}
        </div>
        <p className="text-muted-foreground text-[15.5px]">{summary}</p>
      </div>
      {action}
    </header>
  );
}

export function StatusTag({
  tone,
  children,
}: {
  tone: "on" | "off" | "soon";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-bold",
        tone === "on" ? TINT.success : TINT.muted,
      )}
    >
      {children}
    </span>
  );
}

/** The big preview and "At a glance" beside it. */
export function Hero({ preview, glance }: { preview: ReactNode; glance: ReactNode }) {
  return (
    <div className="flex flex-wrap items-stretch gap-[22px]">
      <div aria-hidden="true" className="min-w-0 flex-[999_1_560px]">
        {preview}
      </div>
      <aside
        aria-label="At a glance"
        className="bg-card text-card-foreground ring-foreground/6 rounded-card edge flex flex-[1_1_300px] flex-col gap-3.5 p-6 ring-1"
      >
        <h2 className="heading text-[17px]">At a glance</h2>
        {glance}
      </aside>
    </div>
  );
}

export function Glance({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground text-[12.5px]">{k}</dt>
          <dd className="mt-0.5 text-sm leading-snug font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One feature: what it does and its exact details, beside a preview. */
export function FeatureCard({
  id,
  title,
  lead,
  details,
  extra,
  panel,
  preview,
}: {
  id: string;
  title: string;
  lead: string;
  details?: [string, ReactNode][];
  /** Between the lead and the details (a row of steps). */
  extra?: ReactNode;
  panel: keyof typeof PANEL;
  preview: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="bg-card text-card-foreground ring-foreground/6 rounded-card edge flex flex-wrap overflow-hidden ring-1"
    >
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3.5 p-6 sm:p-8">
        <h2 id={id} className="heading text-[24px] leading-tight tracking-tight sm:text-[26px]">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-[46ch] text-[15px] leading-relaxed">{lead}</p>
        {extra}
        {details && details.length > 0 && (
          <dl>
            {details.map(([k, v]) => (
              <div
                key={k}
                className="border-border grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-t py-2.5 text-[13.5px] leading-snug sm:grid-cols-[120px_minmax(0,1fr)]"
              >
                <dt className="font-semibold">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "flex min-w-0 flex-[1_1_420px] flex-col justify-center gap-3 p-6 sm:p-8",
          PANEL[panel],
        )}
      >
        {preview}
      </div>
    </section>
  );
}

/** A small card inside a preview. */
export function Mini({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        // Dark mode: a hairline edge, since a shadow doesn't show there.
        "bg-card text-card-foreground rounded-tile flex flex-col gap-2.5 p-[18px] shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_6%,transparent),0_12px_32px_-14px_color-mix(in_oklab,var(--foreground)_14%,transparent)] dark:ring-1 dark:ring-white/[0.06]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({ tint = "muted", children }: { tint?: Tint; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap",
        TINT[tint],
      )}
    >
      {children}
    </span>
  );
}

/** Steps in order, with arrows between the ones that follow each other. */
export function Steps({
  label,
  steps,
}: {
  label: string;
  steps: { name: string; tint: Tint; then?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={label} role="list">
      {steps.map((s, i) => (
        <span key={s.name} role="listitem" className="flex items-center gap-1.5">
          {i > 0 && s.then !== false && (
            <ArrowRight className="text-muted-foreground size-3.5" aria-hidden="true" />
          )}
          <Pill tint={s.tint}>{s.name}</Pill>
        </span>
      ))}
    </div>
  );
}

/** A bar in a preview, filled to `pct`. */
export function Bar({ pct, color, className }: { pct: number; color: string; className?: string }) {
  return (
    <span className={cn("bg-muted block h-2.5 overflow-hidden rounded-full", className)}>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}
