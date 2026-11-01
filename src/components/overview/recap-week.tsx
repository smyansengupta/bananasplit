import {
  CalendarDays,
  CheckSquare,
  Link2,
  NotebookText,
  User,
  Wallet,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import type { CSSProperties } from "react";

import { tagToken, type TagColor } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";
import type {
  RecapStat,
  RecapTone,
  RecapWeek as RecapWeekData,
} from "@/server/overview/recap-week-text";
import { RECAP_TONE_LABEL } from "@/server/overview/recap-week-text";

import { LinkChips } from "./connections";
import { RecapWeekActions } from "./recap-week-actions";

/**
 * The week, recapped (the Inbox's Announcements, "This week"): a few
 * written sentences about the last
 * seven days, five numbers with their change from the week before, up to
 * three findings (going well, at risk, stuck) linked to what they're
 * about, and a foot that says what it was written from, with Copy and
 * Post as an announcement. Everything is counted from the workspace by
 * loadRecapWeek; a part with nothing to say is left out.
 */

const STAT: Record<RecapStat["key"], { Icon: IconComponent; color: TagColor }> = {
  tasks: { Icon: CheckSquare, color: "navy" },
  members: { Icon: User, color: "burgundy" },
  attendance: { Icon: CalendarDays, color: "plum" },
  spent: { Icon: Wallet, color: "forest" },
  notes: { Icon: NotebookText, color: "ochre" },
};

const TONE_TAG: Record<RecapTone, string> = {
  good: "bg-tint-success text-tint-success-foreground",
  risk: "bg-tint-danger text-tint-danger-foreground",
  stuck:
    "bg-[color-mix(in_oklab,var(--k)_16%,var(--card))] text-[color-mix(in_oklab,var(--k)_70%,var(--foreground))]",
};

function StatTile({ stat }: { stat: RecapStat }) {
  const { Icon, color } = STAT[stat.key];
  return (
    <Link
      href={stat.href}
      style={{ "--k": `var(${tagToken(color)})` } as CSSProperties}
      className="bg-muted/60 hover:bg-muted rounded-tile focus-glow flex min-w-0 flex-col gap-2 p-4 transition-colors outline-none"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
        <Icon className="size-3.5 shrink-0 text-(--k)" aria-hidden="true" />
        <span className="truncate">{stat.label}</span>
      </span>
      <span className="flex items-baseline gap-2">
        <b className="numeral text-[30px] leading-none">{stat.value}</b>
        {stat.aside && (
          <span
            className={cn(
              "text-[13px] font-semibold",
              stat.asideTone === "up" && "text-tint-success-foreground",
              stat.asideTone === "down" && "text-tint-danger-foreground",
              stat.asideTone === "plain" && "text-foreground/80",
            )}
          >
            {stat.aside}
          </span>
        )}
      </span>
      {stat.sub && <span className="text-muted-foreground truncate text-[12.5px]">{stat.sub}</span>}
    </Link>
  );
}

export function RecapWeek({
  orgId,
  data,
  posted = false,
}: {
  orgId: string;
  data: RecapWeekData;
  /** This recap already went out as an announcement: Post shows as done. */
  posted?: boolean;
}) {
  const empty = data.summary.length === 0 && data.stats.length === 0 && data.findings.length === 0;
  if (empty) {
    return (
      <p className="text-muted-foreground py-2 text-[14px]">
        A quiet week: nothing was finished, joined, held or written.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {data.summary.length > 0 && (
        <p className="heading max-w-[62rem] text-[clamp(1.125rem,1.6vw,1.5rem)] leading-snug font-normal text-balance [&_b]:font-semibold">
          {data.summary.map((run, i) =>
            run.bold ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>,
          )}
        </p>
      )}

      {data.stats.length > 0 && (
        <ul className="grid [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          {data.stats.map((s) => (
            <li key={s.key} className="min-w-0">
              <StatTile stat={s} />
            </li>
          ))}
        </ul>
      )}

      {data.findings.length > 0 && (
        <ul className="grid [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))] gap-2.5">
          {data.findings.map((f) => (
            <li
              key={f.tone}
              className="bg-card ring-foreground/8 rounded-tile flex min-w-0 flex-col items-start gap-2.5 p-4 ring-1"
            >
              <span
                style={{ "--k": `var(${tagToken("ochre")})` } as CSSProperties}
                className={cn(
                  "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold",
                  TONE_TAG[f.tone],
                )}
              >
                {RECAP_TONE_LABEL[f.tone]}
              </span>
              <p className="text-[13.5px] leading-snug">{f.text}</p>
              <LinkChips items={f.chips} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {data.foot && (
          <p className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px]">
            <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{data.foot}</span>
          </p>
        )}
        <RecapWeekActions orgId={orgId} text={data.text} posted={posted} />
      </div>
    </div>
  );
}
