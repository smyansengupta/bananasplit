import {
  Banknote,
  CalendarDays,
  CheckSquare,
  Layers,
  Sparkles,
  UserPlus,
  Users,
  Vote,
} from "@/components/icons";
import type { ReactNode } from "react";

import { formatCents } from "@/lib/finance/money";
import {
  pulseHeadline,
  pulseRows,
  pulseTitle,
  type PulseFinance,
  type PulseIssueData,
  type PulseRowIcon,
} from "@/lib/pulse/data";

/**
 * One week's pulse (redesign guide 15.1), as the email shows it: the club
 * and week, the headline, Claude's summary and the officers' note, then a
 * row per item. "Money moved" only when the page passes `finance` (finance
 * roles, worked out at render time).
 */

const ICONS: Record<PulseRowIcon, ReactNode> = {
  epic: <Layers />,
  done: <CheckSquare />,
  people: <Users />,
  poll: <Vote />,
  calendar: <CalendarDays />,
  member: <UserPlus />,
  money: <Banknote />,
};

function Row({ icon, title, detail }: { icon: ReactNode; title: string; detail: string | null }) {
  return (
    <li className="flex items-start gap-3.5 py-3.5 first:pt-0">
      <span
        aria-hidden="true"
        className="bg-muted grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="min-w-0 pt-1">
        <p className="text-[15px] leading-snug font-semibold">{title}</p>
        {detail && <p className="text-muted-foreground mt-0.5 text-sm">{detail}</p>}
      </div>
    </li>
  );
}

export function PulseIssueView({
  clubName,
  data,
  note,
  finance,
  status,
  noteSlot,
}: {
  clubName: string;
  data: PulseIssueData;
  note: string | null;
  finance: PulseFinance | null;
  /** "Sent Fri, Oct 16" or "Goes out Fri, Oct 23 at 5:00 PM". */
  status: string;
  /** The admin's note form, on a draft. */
  noteSlot?: ReactNode;
}) {
  const rows = pulseRows(data);
  const pending = finance?.pendingReimbursements ?? 0;
  return (
    <article className="bg-card edge ring-foreground/6 rounded-card overflow-hidden ring-1">
      <header className="bg-chrome text-chrome-foreground glow-corner space-y-1.5 px-6 py-6 sm:px-8">
        <p className="text-[13px] font-medium opacity-75">
          Weekly pulse · {clubName} · {status}
        </p>
        <h2 className="display-title text-[28px] sm:text-[32px]">{pulseTitle(data.range)}</h2>
        <p className="text-[14px] opacity-80">{pulseHeadline(data)}</p>
      </header>
      <div className="space-y-5 px-6 py-6 sm:px-8">
        {data.summary && (
          <p className="flex gap-2.5 text-[15px] leading-relaxed">
            <Sparkles className="text-muted-foreground mt-1 size-4 shrink-0" aria-label="Summary by Claude" />
            {data.summary}
          </p>
        )}
        {noteSlot ??
          (note && (
            <div className="bg-muted/60 rounded-tile px-4 py-3.5">
              <p className="text-muted-foreground text-[13px] font-medium">A note from the officers</p>
              <p className="mt-1 text-[15px] whitespace-pre-line">{note}</p>
            </div>
          ))}
        <ul className="divide-border/70 divide-y">
          {rows.map((r) => (
            <Row key={`${r.icon}:${r.title}`} icon={ICONS[r.icon]} title={r.title} detail={r.detail} />
          ))}
          {finance && (
            <Row
              icon={ICONS.money}
              title={`Money moved: ${formatCents(finance.inCents)} in, ${formatCents(finance.outCents)} out`}
              detail={`Only finance roles see this. ${
                pending === 0
                  ? "No expenses waiting for review."
                  : `${pending} expense${pending === 1 ? "" : "s"} waiting for review.`
              }`}
            />
          )}
        </ul>
      </div>
    </article>
  );
}
