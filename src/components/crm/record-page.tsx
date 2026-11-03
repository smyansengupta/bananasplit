import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/crm/fields";
import { STRENGTH_LABELS, strengthBand } from "@/lib/crm/strength";
import { cn } from "@/lib/utils";

/**
 * The frame every CRM record page shares: back to its list, the name in the
 * display face with its facts under it, the actions at the right, then the
 * fields and sections on one side and the timeline on the other.
 */
export function RecordPage({
  back,
  name,
  sub,
  badges,
  facts,
  actions,
  side,
  main,
  tabs,
  square = false,
}: {
  back: { href: string; label: string };
  name: string;
  sub?: ReactNode;
  badges?: ReactNode;
  facts?: { label: string; value: ReactNode }[];
  actions?: ReactNode;
  /** Fields and sections. */
  side: ReactNode;
  /** The timeline. */
  main: ReactNode;
  tabs?: ReactNode;
  square?: boolean;
}) {
  return (
    <div className="space-y-6">
      {tabs}
      <div className="space-y-4">
        <BackLink href={back.href} label={back.label} />
        <header className="flex flex-wrap items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "bg-tint-info text-tint-info-foreground grid size-14 shrink-0 place-items-center text-lg font-bold",
              square ? "rounded-2xl" : "rounded-full",
            )}
          >
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="page-title break-words">{name}</h1>
            {sub && <p className="text-muted-foreground text-[15px]">{sub}</p>}
            {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {facts && facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="bg-card ring-foreground/6 rounded-2xl px-4 py-3 ring-1">
                <dt className="text-muted-foreground text-xs">{f.label}</dt>
                <dd className="mt-0.5 truncate text-[15px] font-semibold">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">{side}</div>
        <div className="min-w-0 space-y-3">
          <h2 className="heading text-lg">Timeline</h2>
          {main}
        </div>
      </div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
      <div className="flex items-center gap-2">
        <h2 className="heading flex-1 text-base">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StrengthBadge({ strength }: { strength: number }) {
  const band = strengthBand(strength);
  return (
    <Badge variant={band === "strong" ? "success" : band === "fair" ? "info" : "secondary"} title={`Relationship strength ${strength} of 100`}>
      {STRENGTH_LABELS[band]}
    </Badge>
  );
}

export function when(d: Date | null | undefined): string {
  if (!d) return "Never";
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  if (days < 0) return `In ${-days} days`;
  if (days < 45) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
