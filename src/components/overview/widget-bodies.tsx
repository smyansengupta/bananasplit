import { Check, ClipboardList, FileText, Globe, ListChecks, Vote } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PIN_KIND_LABELS } from "@/components/shell/pin-icons";
import { dayWordOfKey } from "@/lib/overview/format";
import type { PinKind } from "@/lib/pins/pages";
import { ago } from "@/lib/relative-time";
import { tagToken } from "@/lib/tag-colors";
import { localDateKey } from "@/lib/tasks/dates";
import type { OpenFormStat, PickUpChange } from "@/server/overview/queries";

import { LinkChips, type ItemRef } from "./connections";
import { KIND_ICON, KindIcon, SECTION_ICON, kindToken, pageSection } from "./kind-tiles";

/**
 * Bodies of the Overview widgets (redesign guide 9.2), as server
 * components: the board places them in its cards. Pick up where you left
 * off lists the pages you opened, each in its kind's colour
 * (kind-tiles.tsx), with what changed since; open forms are bars of their
 * responses, with what's new and what each is linked to.
 */

/**
 * "Pick up where you left off": the pages you opened, newest first, each
 * saying what changed since you last opened it where that can be counted
 * (loadPickUpChanges), else when you opened it.
 */
export function RecentList({
  items,
  changes,
  now,
}: {
  items: readonly { href: string; label: string; kind: PinKind; visitedAt: Date }[];
  changes?: ReadonlyMap<string, PickUpChange>;
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
    <ul className="divide-border/70 divide-y">
      {items.map((item) => {
        const Icon =
          SECTION_ICON[pageSection(item.kind, item.href)] ?? KIND_ICON[item.kind] ?? FileText;
        const change = changes?.get(item.href);
        return (
          <li key={item.href} className="py-1 first:pt-0 last:pb-0">
            <Link
              href={item.href}
              className="hover:bg-muted/60 rounded-field -mx-2 flex min-w-0 items-center gap-3 px-2 py-2"
            >
              <KindIcon
                color={kindToken(item.kind, item.href)}
                className="size-9 rounded-[11px] [&_svg]:size-4"
              >
                <Icon />
              </KindIcon>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{item.label}</span>
                <span className="text-muted-foreground mt-0.5 block truncate text-[12.5px]">
                  {change?.line ??
                    `${PIN_KIND_LABELS[item.kind] ?? "Page"}, opened ${ago(item.visitedAt, now)}`}
                </span>
              </span>
              {change && change.fresh > 0 && (
                <span className="bg-tint-info text-tint-info-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
                  {change.fresh} new
                </span>
              )}
            </Link>
          </li>
        );
      })}
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
 * compare the forms' response counts with each other. Under each: how many
 * came in this week and wait on a review, and chips for what it's linked to.
 * A form whose responses the viewer can't read (a member: they're owners'
 * and admins' to read) shows no count and no bar, only how long it's open.
 */
export function PollList({
  orgSlug,
  forms,
  now,
  timeZone,
  fresh,
  links,
}: {
  orgSlug: string;
  forms: readonly OpenFormStat[];
  now: Date;
  timeZone: string;
  /** A form's responses in the last seven days, by form id. */
  fresh?: ReadonlyMap<string, number>;
  /** What each form is linked to, by form id. */
  links?: ReadonlyMap<string, readonly ItemRef[]>;
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
  const counted = forms.flatMap((f) => (f.responses === null ? [] : [f.responses]));
  const loudest = Math.max(
    1,
    ...forms.flatMap((f) => (f.outOf === null && f.responses !== null ? [f.responses] : [])),
  );
  const total = counted.reduce((n, r) => n + r, 0);
  return (
    <div className="space-y-4">
      {counted.length > 0 && (
        <p className="flex items-baseline gap-2">
          <b className="numeral text-[32px] leading-none">{total}</b>
          <span className="text-muted-foreground text-[13px]">
            {total === 1 ? "response" : "responses"} so far
          </span>
        </p>
      )}
      <ul className="space-y-3.5">
        {forms.map((f) => {
          const kind = FORM_KIND[f.kind];
          const responses = f.responses;
          const outOf =
            f.outOf !== null && responses !== null ? Math.max(f.outOf, responses) : null;
          const pct = responses !== null ? (responses / Math.max(1, outOf ?? loudest)) * 100 : 0;
          const until = f.closesAt
            ? closesWord(dayWordOfKey(localDateKey(f.closesAt, timeZone), todayKey))
            : null;
          // Without counts the line says how long it's open, which is all there is.
          const closes = until
            ? `${responses === null ? "open until" : "closes"} ${until}`
            : "open";
          const week = fresh?.get(f.id) ?? 0;
          const chips = links?.get(f.id) ?? [];
          return (
            <li key={f.id} className="flex items-start gap-3">
              <KindIcon color={kind.color} className="size-8 rounded-[10px] [&_svg]:size-4">
                <kind.Icon />
              </KindIcon>
              <span className="min-w-0 flex-1">
                <Link href={f.href} className="group/form block">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[14px] font-semibold group-hover/form:underline">
                      {f.title}
                    </span>
                    {responses !== null && (
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                        {outOf !== null ? (
                          <>
                            {responses}
                            <span className="text-muted-foreground font-medium">/{outOf}</span>
                          </>
                        ) : (
                          responses
                        )}
                      </span>
                    )}
                  </span>
                  {responses !== null && (
                    <span
                      role="img"
                      aria-label={
                        outOf !== null
                          ? `${responses} of ${outOf} answered`
                          : `${responses} ${responses === 1 ? "response" : "responses"}`
                      }
                      className="bg-muted-strong mt-1.5 block h-2 overflow-hidden rounded-full"
                    >
                      <span
                        className="block h-full rounded-full bg-(--chart-1) transition-[width] duration-700"
                        style={{ width: `${Math.max(pct, responses > 0 ? 4 : 0)}%` }}
                      />
                    </span>
                  )}
                  <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    <span>
                      {kind.word}, {closes}
                    </span>
                    {week > 0 && <span>{week} new this week</span>}
                    {f.toReview > 0 && (
                      <span className="text-foreground font-semibold">{f.toReview} to review</span>
                    )}
                    {f.mine && (
                      <span className="bg-tint-success text-tint-success-foreground inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11.5px] font-semibold">
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                        You answered
                      </span>
                    )}
                  </span>
                </Link>
                <LinkChips items={chips} className="mt-2" />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
