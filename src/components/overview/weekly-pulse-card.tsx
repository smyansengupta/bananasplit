import { CalendarDays, CheckSquare, Layers, PenLine, UserPlus, Users, Vote } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { pollOutcome, pulseProjectLine, type PulseIssueData } from "@/lib/pulse/data";
import type { TrendWeek } from "@/server/pulse/queries";

import { TileIcon, TileText } from "./bits";
import { PulseTrendChart, PulseTrendLegend } from "./pulse-trend-chart";

/**
 * The Overview's Weekly pulse (redesign guide 9 and 15, replacing the old
 * Club pulse): the latest issue's headline figure, tasks finished per week
 * against the average, and three highlight tiles. Nothing about money.
 * The board's card header holds "Sent Fri, Oct 9" and ↗ to the archive.
 */

interface Highlight {
  icon: ReactNode;
  title: string;
  sub: string;
}

export function pulseHighlights(data: PulseIssueData): Highlight[] {
  const out: Highlight[] = [];
  const epic = data.epicsFinished?.[0];
  if (epic) out.push({ icon: <Layers />, title: epic.title, sub: "Epic finished" });
  if (out.length === 0 && data.doneCount > 0) {
    const n = data.doneCount;
    out.push({
      icon: <CheckSquare />,
      title: `${n} task${n === 1 ? "" : "s"} finished`,
      sub: pulseProjectLine(data, 3),
    });
  }
  const event = [...data.events].sort((a, b) => b.checkIns - a.checkIns)[0];
  if (event) {
    out.push({
      icon: <Users />,
      title: event.checkIns > 0 ? `${event.checkIns} at the ${event.title}` : event.title,
      sub: event.checkIns > 0 ? "Checked in" : "Held this week",
    });
  }
  if (data.newMembers.length > 0) {
    const n = data.newMembers.length;
    out.push({
      icon: <UserPlus />,
      title: `${n} new member${n === 1 ? "" : "s"}`,
      sub: "Joined this week",
    });
  }
  const poll = data.pollResults[0];
  if (poll && out.length < 3)
    out.push({ icon: <Vote />, title: poll.question, sub: pollOutcome(poll) });
  const next = data.nextWeek[0];
  if (next && out.length < 3)
    out.push({ icon: <CalendarDays />, title: next.title, sub: "Next week" });
  return out.slice(0, 3);
}

export function WeeklyPulseCard({
  issue,
  trend,
  archiveHref,
  issueHref,
  nextSend,
  draftHref,
}: {
  issue: { data: PulseIssueData } | null;
  trend: readonly TrendWeek[];
  archiveHref: string;
  issueHref: string | null;
  /** "Fri, Oct 23 at 5:00 PM", or null when the pulse is off. */
  nextSend: string | null;
  /** Admins: this week's draft, to add a note before it goes out. */
  draftHref: string | null;
}) {
  // The last full week is the latest issue's; the trend's final point is the week under way.
  const finished = trend.slice(0, -1);
  const total = finished.reduce((n, w) => n + w.done, 0);
  const average = finished.length > 0 ? total / finished.length : 0;
  const lastWeek = issue?.data.doneCount ?? finished.at(-1)?.done ?? 0;
  const highlights = issue ? pulseHighlights(issue.data) : [];

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <b className="numeral text-[40px] leading-none">{lastWeek}</b>
        <span className="text-muted-foreground text-sm">
          tasks done last week, {total} in the last {finished.length} weeks
        </span>
      </div>
      <PulseTrendLegend average={average} />
      <PulseTrendChart
        points={trend.map((w) => ({ label: w.label, value: w.done }))}
        average={average}
      />
      {highlights.length > 0 && issueHref && (
        <ul className="grid gap-2.5 sm:grid-cols-3">
          {highlights.map((h) => (
            <li key={h.title} className="min-w-0">
              <Link
                href={issueHref}
                className="bg-muted/60 hover:bg-muted rounded-tile flex min-w-0 items-center gap-3 p-3.5 transition-colors"
              >
                <TileIcon>{h.icon}</TileIcon>
                <TileText title={h.title} sub={h.sub} />
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
          {draftHref && (
            <Link
              href={draftHref}
              className="text-foreground inline-flex items-center gap-1.5 font-semibold"
            >
              <PenLine className="size-3.5" aria-hidden="true" />
              Add a note to this week&apos;s pulse
            </Link>
          )}
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
