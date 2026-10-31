import { formatDistanceToNow } from "date-fns";
import { Check, ClipboardList, Globe, ListChecks, Vote } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PIN_KIND_LABELS } from "@/components/shell/pin-icons";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { dayWordOfKey } from "@/lib/overview/format";
import type { PinKind } from "@/lib/pins/pages";
import { ago } from "@/lib/relative-time";
import { tagToken } from "@/lib/tag-colors";
import { localDateKey } from "@/lib/tasks/dates";
import type { OpenFormStat } from "@/server/overview/queries";

import { KindIcon, KindTile } from "./kind-tiles";

/**
 * Bodies of the Overview widgets (redesign guide 9.2), as server
 * components: the board places them in its cards. Pages, notes, files and
 * pins are coloured tiles, one colour per kind (kind-tiles.tsx); open
 * forms are bars of their responses.
 */

const TILE_GRID = "grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]";

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
        description="Pages you open show up here."
      />
    );
  }
  return (
    <ul className={TILE_GRID}>
      {items.map((item) => (
        <li key={item.href} className="min-w-0">
          <KindTile
            href={item.href}
            kind={item.kind}
            title={item.label}
            sub={`${PIN_KIND_LABELS[item.kind] ?? "Page"}, ${ago(item.visitedAt, now)}`}
          />
        </li>
      ))}
    </ul>
  );
}

/** "today" and "tomorrow" read lower-case mid-sentence; day names keep their capital. */
function closesWord(word: string): string {
  return word === "Today" || word === "Tomorrow" ? word.toLowerCase() : word;
}

const FORM_KIND: Record<
  OpenFormStat["kind"],
  { word: string; color: string; Icon: typeof ClipboardList }
> = {
  form: { word: "Form", color: `var(${tagToken("teal")})`, Icon: ClipboardList },
  poll: { word: "Quick poll", color: `var(${tagToken("navy")})`, Icon: ListChecks },
  question: { word: "Member poll", color: `var(${tagToken("plum")})`, Icon: Vote },
  website: { word: "Website poll", color: `var(${tagToken("rust")})`, Icon: Globe },
};

/**
 * Open forms, as the Forms list has them: forms, quick polls, member polls
 * and website polls, each a bar of its responses. Where who can answer is
 * a known number the bar runs to it ("12 of 40"); otherwise the bars
 * compare the forms' response counts with each other.
 */
export function PollList({
  orgSlug,
  forms,
  now,
  timeZone,
}: {
  orgSlug: string;
  forms: readonly OpenFormStat[];
  now: Date;
  timeZone: string;
}) {
  if (forms.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No open forms"
        description="Applications, sign-ups and quick polls show up here while they take answers."
        action={
          <Link
            href={`/app/${orgSlug}/forms/new`}
            className="text-sm font-semibold underline underline-offset-4"
          >
            New form
          </Link>
        }
      />
    );
  }
  const todayKey = localDateKey(now, timeZone);
  const loudest = Math.max(1, ...forms.filter((f) => f.outOf === null).map((f) => f.responses));
  const total = forms.reduce((n, f) => n + f.responses, 0);
  return (
    <div className="space-y-4">
      <p className="flex items-baseline gap-2">
        <b className="numeral text-[32px] leading-none">{total}</b>
        <span className="text-muted-foreground text-[13px]">
          {total === 1 ? "response" : "responses"} so far
        </span>
      </p>
      <ul className="space-y-3.5">
        {forms.map((f) => {
          const kind = FORM_KIND[f.kind];
          const outOf = f.outOf !== null ? Math.max(f.outOf, f.responses) : null;
          const pct = (f.responses / Math.max(1, outOf ?? loudest)) * 100;
          const closes = f.closesAt
            ? `closes ${closesWord(dayWordOfKey(localDateKey(f.closesAt, timeZone), todayKey))}`
            : "open";
          return (
            <li key={f.id}>
              <Link href={f.href} className="group/form flex items-start gap-3">
                <KindIcon color={kind.color} className="size-8 rounded-[10px] [&_svg]:size-4">
                  <kind.Icon />
                </KindIcon>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[14px] font-semibold group-hover/form:underline">
                      {f.title}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                      {outOf !== null ? (
                        <>
                          {f.responses}
                          <span className="text-muted-foreground font-medium">/{outOf}</span>
                        </>
                      ) : (
                        f.responses
                      )}
                    </span>
                  </span>
                  <span
                    role="img"
                    aria-label={
                      outOf !== null
                        ? `${f.responses} of ${outOf} answered`
                        : `${f.responses} ${f.responses === 1 ? "response" : "responses"}`
                    }
                    className="bg-muted-strong mt-1.5 block h-2 overflow-hidden rounded-full"
                  >
                    <span
                      className="block h-full rounded-full bg-(--chart-1) transition-[width] duration-700"
                      style={{ width: `${Math.max(pct, f.responses > 0 ? 4 : 0)}%` }}
                    />
                  </span>
                  <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    <span>
                      {kind.word}, {closes}
                    </span>
                    {f.mine && (
                      <span className="bg-tint-success text-tint-success-foreground inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11.5px] font-semibold">
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                        You answered
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
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
          <KindTile
            href={`/app/${orgSlug}/notes/${n.id}`}
            kind="note"
            title={n.title || "Untitled note"}
            sub={`${n.visibility === "PRIVATE" ? "Private, " : ""}${n.updatedBy?.name ?? "Someone"}, ${formatDistanceToNow(n.updatedAt, { addSuffix: true })}`}
          />
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
    return <EmptyState size="compact" title="No files yet" />;
  }
  return (
    <ul className={TILE_GRID}>
      {files.map((f) => (
        <li key={f.id} className="min-w-0">
          <KindTile
            href={`/app/${orgSlug}/notes/files/${f.id}`}
            kind="file"
            title={f.name}
            sub={formatDistanceToNow(f.createdAt, { addSuffix: true })}
          />
        </li>
      ))}
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
