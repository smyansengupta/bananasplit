import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckSquare,
  Layers,
  Megaphone,
  Minus,
  PenLine,
  UserPlus,
  Users,
  Vote,
} from "@/components/icons";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { AmbientButton } from "@/components/ambient/ambient-button";
import { pollOutcome, pulseProjectLine, type PulseIssueData } from "@/lib/pulse/data";
import { tagToken, type TagColor } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";
import type { TrendWeek } from "@/server/pulse/queries";

import { LinkChips, type ItemRef } from "./connections";
import { KindIcon } from "./kind-tiles";
import { PulseBars } from "./pulse-bars";

/**
 * The Overview's Weekly pulse (redesign guide 9 and 15): the latest
 * issue's figures on the left (tasks done last week against the average,
 * the run of weeks, the best one), tasks finished per week as columns on
 * the right, one finding about the run (the page works it out) with chips
 * for the epics and events behind it, and the issue's highlights as
 * coloured tiles under both. Nothing about money. The board's card header holds "Sent Fri, Oct 9"
 * and the link to the archive.
 */

interface Highlight {
  icon: ReactNode;
  title: string;
  sub: string;
  color: TagColor;
}

function pulseHighlights(data: PulseIssueData): Highlight[] {
  const out: Highlight[] = [];
  const epic = data.epicsFinished?.[0];
  if (epic) out.push({ icon: <Layers />, title: epic.title, sub: "Epic finished", color: "navy" });
  if (out.length === 0 && data.doneCount > 0) {
    const n = data.doneCount;
    out.push({
      icon: <CheckSquare />,
      title: `${n} task${n === 1 ? "" : "s"} finished`,
      sub: pulseProjectLine(data, 3),
      color: "navy",
    });
  }
  const event = [...data.events].sort((a, b) => b.checkIns - a.checkIns)[0];
  if (event) {
    out.push({
      icon: <Users />,
      title: event.checkIns > 0 ? `${event.checkIns} at the ${event.title}` : event.title,
      sub: event.checkIns > 0 ? "Checked in" : "Held this week",
      color: "plum",
    });
  }
  if (data.newMembers.length > 0) {
    const n = data.newMembers.length;
    out.push({
      icon: <UserPlus />,
      title: `${n} new member${n === 1 ? "" : "s"}`,
      sub: "Joined this week",
      color: "forest",
    });
  }
  const poll = data.pollResults[0];
  if (poll && out.length < 3)
    out.push({ icon: <Vote />, title: poll.question, sub: pollOutcome(poll), color: "teal" });
  const next = data.nextWeek[0];
  if (next && out.length < 3)
    out.push({ icon: <CalendarDays />, title: next.title, sub: "Next week", color: "rust" });
  return out.slice(0, 3);
}

export function WeeklyPulseCard({
  issue,
  trend,
  archiveHref,
  issueHref,
  nextSend,
  draftHref,
  recap = false,
  insight,
  chips = [],
}: {
  issue: { data: PulseIssueData } | null;
  trend: readonly TrendWeek[];
  archiveHref: string;
  issueHref: string | null;
  /** "Fri, Oct 23 at 5:00 PM", or null when the pulse is off. */
  nextSend: string | null;
  /** Admins: this week's draft, to add a note before it goes out. */
  draftHref: string | null;
  /** Friday afternoon to Sunday: posting the recap is the main button. */
  recap?: boolean;
  insight?: ReactNode;
  /** The epics that moved and the events held in the issue's week. */
  chips?: readonly ItemRef[];
}) {
  // The last full week is the latest issue's; the trend's final point is the week under way.
  const finished = trend.slice(0, -1);
  const total = finished.reduce((n, w) => n + w.done, 0);
  const average = finished.length > 0 ? total / finished.length : 0;
  const lastWeek = issue?.data.doneCount ?? finished.at(-1)?.done ?? 0;
  const highlights = issue ? pulseHighlights(issue.data) : [];

  const best = finished.reduce((m, w) => Math.max(m, w.done), 0);
  const delta = lastWeek - average;
  const even = Math.abs(delta) < 0.5;
  const trendWord =
    finished.length === 0
      ? null
      : even
        ? "Right on your average"
        : `${Math.round(Math.abs(delta) * 10) / 10} ${delta > 0 ? "above" : "below"} average`;
  const TrendIcon = even ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  const figures = [
    { label: "Average", value: Math.round(average * 10) / 10 },
    { label: `Last ${finished.length} weeks`, value: total },
    { label: "Best week", value: best },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <b className="numeral block text-[52px] leading-none">{lastWeek}</b>
            <span className="text-muted-foreground mt-1.5 block text-sm">
              {lastWeek === 1 ? "task" : "tasks"} done last week
            </span>
          </div>
          {trendWord && (
            <span
              className={cn(
                "inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-semibold",
                even
                  ? "bg-muted text-muted-foreground"
                  : delta > 0
                    ? "bg-tint-success text-tint-success-foreground"
                    : "bg-tint-accent text-tint-accent-foreground",
              )}
            >
              <TrendIcon className="size-3.5" aria-hidden="true" />
              {trendWord}
            </span>
          )}
          <dl className="grid grid-cols-3 gap-2 lg:mt-auto">
            {figures.map((f) => (
              <div key={f.label} className="bg-muted/55 rounded-tile flex flex-col px-3 py-2.5">
                <dt className="text-muted-foreground order-2 mt-1 truncate text-[11.5px]">
                  {f.label}
                </dt>
                <dd className="numeral order-1 text-[20px] leading-none">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-(--chart-1)" />
              Finished
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,var(--chart-1)_0_2px,transparent_2px_4px)] ring-1 ring-(--chart-1) ring-inset"
              />
              This week so far
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="border-foreground/70 w-4 border-t-2 border-dashed"
              />
              Average
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-(--attention)" />
              Trend
            </span>
          </div>
          <PulseBars
            bars={trend.map((w) => ({ label: w.label, value: w.done }))}
            average={average}
          />
        </div>
      </div>
      {insight}
      <LinkChips items={chips} />
      {highlights.length > 0 && issueHref && (
        <ul className="grid gap-2.5 sm:grid-cols-3">
          {highlights.map((h) => (
            <li key={h.title} className="min-w-0">
              <Link
                href={issueHref}
                style={{ "--k": `var(${tagToken(h.color)})` } as CSSProperties}
                className="rounded-tile flex min-w-0 items-center gap-3 bg-[color-mix(in_oklab,var(--k)_8%,var(--card))] p-3.5 ring-1 ring-[color-mix(in_oklab,var(--k)_18%,transparent)] transition-[background-color] ring-inset hover:bg-[color-mix(in_oklab,var(--k)_13%,var(--card))]"
              >
                <KindIcon color="var(--k)">{h.icon}</KindIcon>
                <span className="min-w-0">
                  <span className="block text-sm leading-tight font-semibold break-words">
                    {h.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[12.5px] break-words">
                    {h.sub}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(!issue || draftHref) && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {!issue &&
            (nextSend
              ? `The first pulse goes out ${nextSend}.`
              : "The weekly pulse is off for this organization.")}
          {draftHref &&
            (recap ? (
              <AmbientButton
                action={{
                  key: "post-recap",
                  label: "Post the recap",
                  icon: <Megaphone />,
                  tone: "solid",
                  reason: "This week's recap isn't out yet",
                  href: draftHref,
                }}
              />
            ) : (
              <Link
                href={draftHref}
                className="text-foreground inline-flex items-center gap-1.5 font-semibold"
              >
                <PenLine className="size-3.5" aria-hidden="true" />
                Add a note to this week&apos;s pulse
              </Link>
            ))}
          {!issue && (
            <Link
              href={archiveHref}
              className="text-foreground font-semibold underline underline-offset-4"
            >
              About the pulse
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
