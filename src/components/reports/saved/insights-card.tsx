import Link from "next/link";
import type { ReactNode } from "react";

import { Sparkles } from "@/components/icons";
import type { InsightLine } from "@/lib/reports/compute";
import { cn } from "@/lib/utils";

/**
 * Insights, as the report and Reports home show them: who wrote it, one
 * sentence on what matters most, the lines under it (each with a marker for
 * how it's going, its figure in bold and a link to where it comes from),
 * "What I'd do next", and a box to ask about it. No hooks, so a server page
 * renders it and so does a client one (Reports home after a rewrite).
 */

export interface CardLine extends Pick<InsightLine, "text" | "tone" | "bold" | "direction"> {
  /** The link's words: the widget or report it comes from. */
  label?: string | null;
  href?: string | null;
}

const AMBER = {
  background: "color-mix(in oklab, var(--chart-4) 22%, var(--card))",
  color: "color-mix(in oklab, var(--chart-4) 70%, var(--foreground))",
};

/** The 22px marker: an arrow when a number moved, a dot for a plain fact, "!" for something to look at. */
function Marker({ line }: { line: CardLine }) {
  const moved = line.direction === "up" || line.direction === "down";
  const tint =
    line.tone === "good"
      ? "bg-tint-success text-tint-success-foreground"
      : line.tone === "warn" && moved
        ? "bg-tint-danger text-tint-danger-foreground"
        : line.tone === "info"
          ? "bg-tint-info text-tint-info-foreground"
          : "";
  return (
    <span
      aria-hidden="true"
      className={cn("mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full", tint)}
      style={line.tone === "warn" && !moved ? AMBER : undefined}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {line.direction === "up" ? (
          <path d="m5 15 7-7 7 7" />
        ) : line.direction === "down" ? (
          <path d="m5 9 7 7 7-7" />
        ) : line.tone === "warn" ? (
          <>
            <path d="M12 8v5" />
            <circle cx="12" cy="16.5" r=".8" fill="currentColor" />
          </>
        ) : (
          <circle cx="12" cy="12" r="3" />
        )}
      </svg>
    </span>
  );
}

/** The sentence with its figure in bold (where the figure is in it). */
function Sentence({ text, bold }: { text: string; bold?: string | null }) {
  const at = bold ? text.indexOf(bold) : -1;
  if (!bold || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="font-semibold">{bold}</b>
      {text.slice(at + bold.length)}
    </>
  );
}

function Chip({ label, href }: { label: string; href: string }) {
  const className =
    "border-border bg-card hover:bg-muted focus-glow ms-1.5 inline-flex h-6 items-center rounded-full border px-2.5 align-middle text-xs font-semibold whitespace-nowrap outline-none";
  // A widget on this page is an anchor; a report is a page.
  return href.startsWith("#") ? (
    <a href={href} className={className}>
      {label}
    </a>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export function InsightsCard({
  subtitle,
  lead,
  lines,
  next,
  rewrite,
  ask,
  foot,
  wide = false,
  className,
}: {
  subtitle: string;
  lead: string | null;
  lines: CardLine[];
  next: string | null;
  /** Rewrite (Claude), for whoever may use it. */
  rewrite?: ReactNode;
  /** The ask box, for whoever may use it. */
  ask?: ReactNode;
  foot?: string;
  /** Reports home: bigger type and the lines in two columns. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground ring-foreground/6 rounded-card edge flex flex-col ring-1",
        wide ? "gap-[18px] p-6 sm:p-7" : "gap-4 p-[22px]",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="bg-primary text-primary-foreground grid size-[38px] shrink-0 place-items-center rounded-full">
          <Sparkles className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className={cn("heading", wide ? "text-[19px]" : "text-[17px]")}>Insights</h2>
          <span className="text-muted-foreground block text-[12.5px]">{subtitle}</span>
        </span>
        {rewrite}
      </div>

      {lead ? (
        <p
          className={cn(
            "heading max-w-[62ch] tracking-tight",
            wide
              ? "text-[22px] leading-[1.25] sm:text-[24px]"
              : "text-[19px] leading-[1.28] sm:text-[21px]",
          )}
        >
          {lead}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing stands out yet. Add rows, or widgets with numbers, and this fills in.
        </p>
      )}

      {lines.length > 0 && (
        <ul className={cn(wide ? "grid gap-x-7 gap-y-3 md:grid-cols-2" : "flex flex-col gap-2.5")}>
          {lines.map((l, i) => (
            <li key={i} className="flex items-start gap-3">
              <Marker line={l} />
              <span className="min-w-0 text-[14px] leading-relaxed">
                <Sentence text={l.text} bold={l.bold} />
                {l.label && l.href && <Chip label={l.label} href={l.href} />}
              </span>
            </li>
          ))}
        </ul>
      )}

      {next && (
        <div className="bg-tint-info flex items-start gap-2.5 rounded-[14px] px-3.5 py-3 text-[13.5px] leading-snug">
          <span className="bg-card text-tint-info-foreground grid size-[22px] shrink-0 place-items-center rounded-full">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <b className="font-semibold">What I&apos;d do next:</b> {next}
          </span>
        </div>
      )}

      {ask}
      {foot && <p className="text-muted-foreground text-xs">{foot}</p>}
    </div>
  );
}

/** Lead, lines and next step from a reading: the first line is the lead when there's no other. */
export function splitReading(reading: {
  lead?: string | null;
  lines: InsightLine[];
  next?: string | null;
}): { lead: string | null; lines: InsightLine[]; next: string | null } {
  const lead = reading.lead ?? reading.lines[0]?.text ?? null;
  const lines = reading.lead ? reading.lines : reading.lines.slice(1);
  const next = reading.next ?? reading.lines.find((l) => l.next)?.next ?? null;
  return { lead, lines, next };
}
