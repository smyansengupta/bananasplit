import { CalendarCheck2, CalendarClock, CalendarX2, Globe, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CalendarSyncState, EventKind, EventVisibility } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { KIND_META, kindStyle, SYNC_META, VISIBILITY_META } from "./kinds";

export function KindBadge({ kind, className }: { kind: EventKind; className?: string }) {
  const meta = KIND_META[kind];
  return (
    <Badge variant="outline" className={cn("gap-1.5", className)} style={kindStyle(kind)}>
      <span aria-hidden className="size-2 rounded-full" style={{ background: "var(--kind)" }} />
      {meta.label}
    </Badge>
  );
}

export function VisibilityBadge({ visibility, className }: { visibility: EventVisibility; className?: string }) {
  const meta = VISIBILITY_META[visibility];
  const Icon = visibility === "PUBLIC" ? Globe : Lock;
  return (
    <Badge variant={visibility === "PUBLIC" ? "secondary" : "outline"} className={cn("gap-1", className)} title={meta.hint}>
      <Icon aria-hidden className="size-3" />
      {meta.label}
    </Badge>
  );
}

export function SyncBadge({
  state,
  className,
  href,
}: {
  state: CalendarSyncState;
  className?: string;
  /** The Google event link, when synced. */
  href?: string | null;
}) {
  const meta = SYNC_META[state];
  const Icon = state === "SYNCED" ? CalendarCheck2 : state === "FAILED" ? CalendarX2 : CalendarClock;
  const badge = (
    <Badge
      variant={state === "FAILED" ? "destructive" : "outline"}
      className={cn("gap-1", state === "NOT_APPLICABLE" && "text-muted-foreground", className)}
      title={meta.hint}
      asChild={Boolean(href && state === "SYNCED")}
    >
      {href && state === "SYNCED" ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          <Icon aria-hidden className="size-3" />
          {meta.label}
        </a>
      ) : (
        <>
          <Icon aria-hidden className="size-3" />
          {meta.label}
        </>
      )}
    </Badge>
  );
  return badge;
}
