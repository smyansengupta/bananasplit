import { formatDistanceToNow } from "date-fns";
import { FileText, Lock, NotebookText } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FILE_ICONS } from "@/components/notes/file-card";
import { PIN_ICONS, PIN_KIND_LABELS } from "@/components/shell/pin-icons";
import { TickMeter } from "@/components/ui/meters";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { familyOf } from "@/lib/files/types";
import { dayWordOfKey } from "@/lib/overview/format";
import type { PinKind } from "@/lib/pins/pages";
import { pollHref } from "@/lib/polls/paths";
import { ago } from "@/lib/relative-time";
import { localDateKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";
import type { PollStat } from "@/server/overview/queries";

import { TileIcon, TileText, tileClass } from "./bits";

/**
 * Bodies of the Overview widgets (redesign guide 9.2), as server
 * components: the board places them in its cards. Tiles carry an icon
 * chip; lists are rows separated by space, a hairline at most.
 */

const TILE_GRID = "grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(12.5rem,1fr))]";

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
        title="Nothing here yet"
        description="The pages you open show up here, so you can jump back in."
      />
    );
  }
  return (
    <ul className={TILE_GRID}>
      {items.map((item) => {
        const Icon = PIN_ICONS[item.kind] ?? FileText;
        return (
          <li key={item.href} className="min-w-0">
            <Link href={item.href} className={tileClass}>
              <TileIcon>
                <Icon />
              </TileIcon>
              <TileText
                title={item.label}
                sub={`${PIN_KIND_LABELS[item.kind] ?? "Page"} · ${ago(item.visitedAt, now)}`}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export interface WeekDay {
  key: string;
  /** "Mon". */
  weekday: string;
  /** "12". */
  date: string;
  isToday: boolean;
  events: { id: string; title: string; time: string }[];
}

/**
 * Seven day tiles, today in the accent. On a phone they stack as one row
 * per day (the day on the left, its events beside it), so a free day is a
 * line, not a tall empty tile.
 */
export function WeekStrip({ orgSlug, days }: { orgSlug: string; days: WeekDay[] }) {
  return (
    <ol className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1 max-sm:gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((d) => (
        <li
          key={d.key}
          aria-current={d.isToday ? "date" : undefined}
          className={cn(
            "rounded-tile flex min-h-28 min-w-0 flex-col gap-2 p-3",
            "max-sm:min-h-0 max-sm:flex-row max-sm:items-start max-sm:gap-3 max-sm:py-2.5",
            d.isToday ? "bg-brand-accent text-brand-accent-foreground glow-halo" : "bg-muted/60",
          )}
        >
          <p className="flex items-baseline gap-1.5 max-sm:w-24 max-sm:shrink-0">
            <span className={cn("text-[13px] font-medium", !d.isToday && "text-muted-foreground")}>
              {d.isToday ? "Today" : d.weekday}
            </span>
            <span className="numeral text-[22px]">{d.date}</span>
          </p>
          <ul className="space-y-1.5 max-sm:min-w-0 max-sm:flex-1 max-sm:self-center">
            {d.events.length === 0 && (
              <li className={cn("text-[12px]", d.isToday ? "opacity-70" : "text-muted-foreground")}>
                Free
              </li>
            )}
            {d.events.slice(0, 3).map((e) => (
              <li key={e.id}>
                <Link
                  href={`/app/${orgSlug}/calendar/${e.id}`}
                  className={cn(
                    "block rounded-[10px] px-2 py-1.5 text-[12px] leading-tight",
                    d.isToday ? "bg-black/10 hover:bg-black/15" : "bg-card hover:bg-background",
                  )}
                >
                  <span className={cn("block", d.isToday ? "opacity-80" : "text-muted-foreground")}>
                    {e.time}
                  </span>
                  <span className="line-clamp-2 font-semibold">{e.title}</span>
                </Link>
              </li>
            ))}
            {d.events.length > 3 && (
              <li className="text-[12px] font-medium opacity-80">+{d.events.length - 3} more</li>
            )}
          </ul>
        </li>
      ))}
    </ol>
  );
}

const TICK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-3)",
  "var(--chart-5)",
];

/** "today" and "tomorrow" read lower-case mid-sentence; day names keep their capital. */
function closesWord(word: string): string {
  return word === "Today" || word === "Tomorrow" ? word.toLowerCase() : word;
}

/** Open polls, one tick per member who can vote. */
export function PollList({
  orgSlug,
  polls,
  now,
  timeZone,
}: {
  orgSlug: string;
  polls: readonly PollStat[];
  now: Date;
  timeZone: string;
}) {
  if (polls.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No open polls"
        description="Questions to vote on and times to find show here."
        action={
          <Link
            href={`/app/${orgSlug}/calendar/polls`}
            className="text-sm font-semibold underline underline-offset-4"
          >
            Start a poll
          </Link>
        }
      />
    );
  }
  const todayKey = localDateKey(now, timeZone);
  return (
    <ul className="space-y-4">
      {polls.map((p, i) => (
        <li key={p.id}>
          <Link href={pollHref(`/app/${orgSlug}`, p.kind, p.id)} className="group/poll block">
            <span className="flex items-baseline justify-between gap-2.5">
              <span className="min-w-0 truncate text-[15px] font-semibold group-hover/poll:underline">
                {p.title}
              </span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                {p.voters}/{p.eligible}
              </span>
            </span>
            <TickMeter
              total={p.eligible}
              filled={p.voters}
              height={20}
              color={TICK_COLORS[i % TICK_COLORS.length]}
              label={`${p.voters} of ${p.eligible} ${p.kind === "question" ? "voted" : "answered"}`}
              className="mt-2"
            />
            <span className="text-muted-foreground mt-1.5 block text-[13px]">
              {p.kind === "question" ? "Question" : "Find a time"} ·{" "}
              {p.closesAt
                ? `closes ${closesWord(dayWordOfKey(localDateKey(p.closesAt, timeZone), todayKey))}`
                : "Open"}
              {p.mine ? " · You answered" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function NoteList({
  orgSlug,
  notes,
}: {
  orgSlug: string;
  notes: {
    id: string;
    title: string;
    visibility: string;
    updatedAt: Date;
    updatedBy: { name: string | null } | null;
  }[];
}) {
  if (notes.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No notes yet"
        action={
          <Link
            href={`/app/${orgSlug}/notes`}
            className="text-sm font-semibold underline underline-offset-4"
          >
            Write the first one
          </Link>
        }
      />
    );
  }
  return (
    <ul className={TILE_GRID}>
      {notes.map((n) => (
        <li key={n.id} className="min-w-0">
          <Link href={`/app/${orgSlug}/notes/${n.id}`} className={tileClass}>
            <TileIcon>
              {n.visibility === "PRIVATE" ? <Lock aria-label="Private" /> : <NotebookText />}
            </TileIcon>
            <TileText
              title={n.title || "Untitled note"}
              sub={`${n.updatedBy?.name ?? "Someone"} · ${formatDistanceToNow(n.updatedAt, { addSuffix: true })}`}
            />
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
    return (
      <EmptyState
        size="compact"
        title="No files yet"
        description="Upload PDFs, slides and images in Files."
      />
    );
  }
  return (
    <ul className={TILE_GRID}>
      {files.map((f) => {
        const Icon = FILE_ICONS[familyOf(f.contentType)];
        return (
          <li key={f.id} className="min-w-0">
            <Link href={`/app/${orgSlug}/notes/files/${f.id}`} className={tileClass}>
              <TileIcon>
                <Icon />
              </TileIcon>
              <TileText
                title={f.name}
                sub={formatDistanceToNow(f.createdAt, { addSuffix: true })}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** People as an avatar grid with the count. */
export function PeopleList({
  orgSlug,
  people,
  total,
}: {
  orgSlug: string;
  people: {
    userId: string;
    title: string | null;
    user: UserAvatarUser & { name: string | null };
  }[];
  total: number;
}) {
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-x-2 gap-y-3">
        {people.map((p) => (
          <li key={p.userId}>
            <Link
              href={`/app/${orgSlug}/people/${p.userId}`}
              title={p.title ? `${p.user.name ?? "Member"}, ${p.title}` : (p.user.name ?? "Member")}
              className="group/person flex flex-col items-center gap-1.5 text-center"
            >
              <UserAvatar
                user={p.user}
                size="lg"
                className="transition-transform duration-200 group-hover/person:-translate-y-0.5"
              />
              <span className="w-full truncate text-[12px] font-medium">
                {p.user.name?.split(/\s+/)[0] ?? "Member"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={`/app/${orgSlug}/people`}
        className="text-muted-foreground hover:text-foreground block text-[13px] font-medium"
      >
        All {total} member{total === 1 ? "" : "s"}
      </Link>
    </div>
  );
}
