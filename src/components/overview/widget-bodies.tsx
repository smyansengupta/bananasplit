import { formatDistanceToNow } from "date-fns";
import {
  Ban,
  CalendarRange,
  CalendarX2,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Sun,
  Vote,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FILE_ICONS } from "@/components/notes/file-card";
import { PIN_ICONS } from "@/components/shell/pin-icons";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { familyOf } from "@/lib/files/types";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

/**
 * Bodies of the Overview widgets that are new with the customizable board
 * (the others reuse their cards in `bare` mode). Server components: the
 * board places them in its frames.
 */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(date: Date, now: Date): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes > -1) return "just now";
  if (minutes > -60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

export function RecentList({
  items,
  now,
}: {
  items: readonly { href: string; label: string; kind: PinKind; visitedAt: Date }[];
  now: Date;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        size="compact"
        icon={Clock}
        title="Nothing here yet"
        description="The pages you open show up here, so you can jump back in."
      />
    );
  }
  return (
    <ul className="divide-y">
      {items.map((item) => {
        const Icon = PIN_ICONS[item.kind] ?? FileText;
        return (
          <li key={item.href}>
            <Link href={item.href} className="hover:bg-accent/50 -mx-2 flex items-center gap-2.5 rounded-md px-2 py-2">
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{ago(item.visitedAt, now)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function TaskStats({
  orgSlug,
  stats,
}: {
  orgSlug: string;
  stats: { open: number; today: number; overdue: number; blocked: number };
}) {
  const cells: { label: string; value: number; icon: LucideIcon; tone?: string; href: string }[] = [
    { label: "Open", value: stats.open, icon: CheckCircle2, href: `/app/${orgSlug}/tasks?view=mine` },
    { label: "Due today", value: stats.today, icon: Sun, tone: "text-warning", href: `/app/${orgSlug}/tasks?view=mine` },
    { label: "Overdue", value: stats.overdue, icon: CalendarX2, tone: "text-destructive", href: `/app/${orgSlug}/tasks?view=mine` },
    { label: "Blocked", value: stats.blocked, icon: Ban, tone: "text-destructive", href: `/app/${orgSlug}/tasks?view=mine&status=BLOCKED` },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {cells.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.label} href={c.href} className="hover:bg-muted/50 rounded-lg border p-2.5">
            <span className="eyebrow text-muted-foreground flex items-center gap-1.5">
              <Icon className={cn("size-3.5", c.value > 0 && c.tone)} aria-hidden="true" />
              {c.label}
            </span>
            <span className={cn("numeral mt-1.5 block text-5xl", c.value > 0 && c.tone)}>
              {c.value}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export interface WeekDay {
  key: string;
  label: string;
  isToday: boolean;
  events: { id: string; title: string; time: string }[];
}

export function WeekStrip({ orgSlug, days }: { orgSlug: string; days: WeekDay[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((d) => (
        <div
          key={d.key}
          className={cn("min-h-24 rounded-lg border p-2", d.isToday && "border-primary/50 bg-primary/5")}
        >
          <p className={cn("eyebrow", d.isToday ? "text-primary" : "text-muted-foreground")}>
            {d.label}
          </p>
          <ul className="mt-1.5 space-y-1">
            {d.events.length === 0 && <li className="text-muted-foreground/60 text-[11px]">Free</li>}
            {d.events.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/app/${orgSlug}/calendar/${e.id}`}
                  className="bg-chart-1/10 hover:bg-chart-1/20 block rounded px-1.5 py-1 text-[11px] leading-tight"
                >
                  <span className="text-muted-foreground block">{e.time}</span>
                  <span className="line-clamp-2 font-medium">{e.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function PollList({
  orgSlug,
  polls,
  now,
}: {
  orgSlug: string;
  /** Open polls of both kinds: questions to vote on, and find-a-time polls. */
  polls: { id: string; title: string; closesAt: Date | null; kind: "question" | "availability" }[];
  now: Date;
}) {
  if (polls.length === 0) {
    return (
      <EmptyState
        size="compact"
        icon={Vote}
        title="No open polls"
        description="Questions to vote on and times to find show here."
        action={
          <Link href={`/app/${orgSlug}/calendar/polls`} className="text-primary text-sm hover:underline">
            Start a poll
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y">
      {polls.map((p) => {
        const Icon = p.kind === "question" ? Vote : CalendarRange;
        return (
          <li key={p.id}>
            <Link
              href={`/app/${orgSlug}/calendar/polls/${p.id}`}
              className="hover:bg-accent/50 -mx-2 flex items-start gap-2.5 rounded-md px-2 py-2"
            >
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.title}</span>
                <span className="text-muted-foreground text-xs">
                  {p.kind === "question" ? "Question" : "Find a time"} ·{" "}
                  {p.closesAt ? `Closes ${formatDistanceToNow(p.closesAt, { addSuffix: true })}` : "Open"}
                  {p.closesAt && p.closesAt < now ? " (closed)" : ""}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function NoteList({
  orgSlug,
  notes,
}: {
  orgSlug: string;
  notes: { id: string; title: string; visibility: string; updatedAt: Date; updatedBy: { name: string | null } | null }[];
}) {
  if (notes.length === 0) {
    return (
      <EmptyState
        size="compact"
        icon={FileText}
        title="No notes yet"
        action={
          <Link href={`/app/${orgSlug}/notes`} className="text-primary text-sm hover:underline">
            Write the first one
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y">
      {notes.map((n) => (
        <li key={n.id}>
          <Link href={`/app/${orgSlug}/notes/${n.id}`} className="hover:bg-accent/50 -mx-2 block rounded-md px-2 py-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {n.visibility === "PRIVATE" && <Lock className="text-muted-foreground size-3" aria-label="Private" />}
              <span className="truncate">{n.title || "Untitled note"}</span>
            </span>
            <span className="text-muted-foreground text-xs">
              {n.updatedBy?.name ?? "Someone"} · {formatDistanceToNow(n.updatedAt, { addSuffix: true })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FileList({
  orgSlug,
  files,
}: {
  orgSlug: string;
  files: { id: string; name: string; contentType: string; createdAt: Date }[];
}) {
  if (files.length === 0) {
    return <EmptyState size="compact" icon={FileText} title="No files yet" description="Upload PDFs, slides and images on the Notes page." />;
  }
  return (
    <ul className="divide-y">
      {files.map((f) => {
        const Icon = FILE_ICONS[familyOf(f.contentType)];
        return (
          <li key={f.id}>
            <Link href={`/app/${orgSlug}/notes/files/${f.id}`} className="hover:bg-accent/50 -mx-2 flex items-center gap-2.5 rounded-md px-2 py-2">
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {formatDistanceToNow(f.createdAt, { addSuffix: true })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PeopleList({
  orgSlug,
  people,
  total,
}: {
  orgSlug: string;
  people: { userId: string; title: string | null; user: UserAvatarUser & { name: string | null } }[];
  total: number;
}) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {people.map((p) => (
          <li key={p.userId}>
            <Link href={`/app/${orgSlug}/people/${p.userId}`} className="hover:bg-accent/50 -mx-2 flex items-center gap-2 rounded-md px-2 py-1">
              <UserAvatar user={p.user} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{p.user.name ?? "Member"}</span>
                {p.title && <span className="text-muted-foreground block truncate text-xs">{p.title}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/app/${orgSlug}/people`} className="text-muted-foreground block text-xs hover:underline">
        All {total} member{total === 1 ? "" : "s"}
      </Link>
    </div>
  );
}

export function Shortcuts({ links }: { links: { id: string; label: string; href: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <Link key={l.id} href={l.href} className="hover:bg-muted rounded-full border px-3 py-1 text-sm">
          {l.label}
        </Link>
      ))}
    </div>
  );
}
