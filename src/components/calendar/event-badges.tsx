import { CalendarCheck2, CalendarClock, CalendarX2, Globe, Lock } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import type { CalendarSyncState, EventVisibility } from "@/generated/prisma/enums";
import { tagToken, type EventTagOption } from "@/lib/calendar/tags";
import { cn } from "@/lib/utils";

import { SYNC_META, VISIBILITY_META } from "./kinds";

/** The event's type as a tag chip: its colour mixed into the card. */
export function KindBadge({
  tag,
  className,
}: {
  tag: Pick<EventTagOption, "name" | "color"> | null;
  className?: string;
}) {
  if (!tag) return null;
  return (
    <TagChip color={`var(${tagToken(tag.color)})`} className={className}>
      {tag.name}
    </TagChip>
  );
}

export function VisibilityBadge({
  visibility,
  className,
}: {
  visibility: EventVisibility;
  className?: string;
}) {
  const meta = VISIBILITY_META[visibility];
  const Icon = visibility === "PUBLIC" ? Globe : Lock;
  return (
    <Badge
      variant={visibility === "PUBLIC" ? "info" : "secondary"}
      className={cn("gap-1", className)}
      title={meta.hint}
    >
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
  const Icon =
    state === "SYNCED" ? CalendarCheck2 : state === "FAILED" ? CalendarX2 : CalendarClock;
  const badge = (
    <Badge
      variant={state === "FAILED" ? "destructive" : state === "SYNCED" ? "success" : "secondary"}
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
