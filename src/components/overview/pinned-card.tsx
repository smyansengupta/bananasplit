import { Clock, FileText, Pin } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PIN_ICONS } from "@/components/shell/pin-icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PinKind } from "@/lib/pins/pages";

const KIND_LABEL: Record<PinKind, string> = {
  page: "Page",
  note: "Note",
  task: "Task",
  event: "Event",
  database: "Database",
  person: "Person",
  file: "File",
};

/** The member's pinned pages, notes and items, as a grid of shortcuts. */
export function PinnedCard({
  pins,
  className,
}: {
  pins: readonly { id: string; href: string; label: string; kind: PinKind }[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Pin className="text-muted-foreground size-4" aria-hidden="true" />
          Pinned
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pins.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Pin}
            title="Nothing pinned yet"
            description="Open a note, a task, a database or any page and press the pin at the top to keep it here."
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {pins.map((pin) => {
              const Icon = PIN_ICONS[pin.kind] ?? FileText;
              return (
                <li key={pin.id}>
                  <Link
                    href={pin.href}
                    className="hover:bg-accent/60 hover:border-foreground/15 flex items-center gap-3 rounded-lg border p-2.5 transition-colors"
                  >
                    <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-md">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{pin.label}</span>
                      <span className="text-muted-foreground block text-xs">{KIND_LABEL[pin.kind]}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(date: Date, now: Date): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes > -1) return "just now";
  if (minutes > -60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

/** The pages the member opened most recently in this org. */
export function RecentlyVisitedCard({
  items,
  now,
  className,
}: {
  items: readonly { href: string; label: string; kind: PinKind; visitedAt: Date }[];
  now: Date;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Clock className="text-muted-foreground size-4" aria-hidden="true" />
          Recently visited
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Clock}
            title="Nothing here yet"
            description="The pages you open show up here, so you can jump back in."
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const Icon = PIN_ICONS[item.kind] ?? FileText;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="hover:bg-accent/50 -mx-2 flex items-center gap-2.5 rounded-md px-2 py-2"
                  >
                    <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">{ago(item.visitedAt, now)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
