import {
  Activity,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock,
  Database,
  Megaphone,
  MessageCircleQuestion,
  NotebookText,
  Paperclip,
  TriangleAlert,
  User,
  Users,
  Vote,
  Wallet,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { ChipKind, ItemRef } from "@/lib/overview/types";
import { tagToken, type TagColor } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

export type { ItemRef };
export type LinkKind = ChipKind;

/**
 * How Home's widgets point at each other and at the rest of the workspace:
 * a chip per linked thing (the event a task is for, the meeting a decision
 * came from, the budget an approval spends), and one sentence that says
 * what the numbers mean. Every Overview widget uses these, so a link to an
 * event looks the same wherever it appears.
 */

const LINK_KIND: Record<LinkKind, { Icon: IconComponent; color: TagColor | null; word: string }> = {
  task: { Icon: CheckSquare, color: "navy", word: "Task" },
  event: { Icon: CalendarDays, color: "plum", word: "Event" },
  meeting: { Icon: Users, color: "plum", word: "Meeting" },
  note: { Icon: NotebookText, color: "forest", word: "Note" },
  file: { Icon: Paperclip, color: "ochre", word: "File" },
  form: { Icon: ClipboardList, color: "teal", word: "Form" },
  poll: { Icon: Vote, color: "teal", word: "Poll" },
  money: { Icon: Wallet, color: "forest", word: "Finance" },
  person: { Icon: User, color: "burgundy", word: "Person" },
  database: { Icon: Database, color: "rust", word: "Database" },
  decision: { Icon: MessageCircleQuestion, color: "navy", word: "Decision" },
  announcement: { Icon: Megaphone, color: "rust", word: "Announcement" },
};

/** One linked thing: its kind's icon in the kind's colour, then its name. */
export function LinkChip({ item, className }: { item: ItemRef; className?: string }) {
  const { Icon, color, word } = LINK_KIND[item.kind];
  return (
    <Link
      href={item.href}
      title={`${word}: ${item.label}`}
      style={color ? ({ "--chip-ink": `var(${tagToken(color)})` } as CSSProperties) : undefined}
      className={cn(
        "border-border bg-card text-foreground/85 hover:text-foreground hover:border-foreground/25 focus-glow inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2 text-xs font-semibold whitespace-nowrap transition-colors outline-none",
        className,
      )}
    >
      <Icon className="size-3 shrink-0 text-(--chip-ink,currentColor)" aria-hidden="true" />
      <span className="truncate">
        <span className="sr-only">{word}: </span>
        {item.label}
      </span>
    </Link>
  );
}

/** A row of chips that wraps. Nothing when there's nothing linked. */
export function LinkChips({ items, className }: { items: readonly ItemRef[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {items.map((item) => (
        <LinkChip key={`${item.kind}:${item.href}:${item.label}`} item={item} />
      ))}
    </span>
  );
}

export type InsightTone = "plain" | "warn" | "good";

const INSIGHT_TONE: Record<InsightTone, { Icon: IconComponent; box: string; dot: string }> = {
  plain: { Icon: Activity, box: "bg-muted/60", dot: "bg-tint-info text-tint-info-foreground" },
  warn: {
    Icon: TriangleAlert,
    box: "bg-tint-danger/50",
    dot: "bg-tint-danger text-tint-danger-foreground",
  },
  good: {
    Icon: Clock,
    box: "bg-tint-success/50",
    dot: "bg-tint-success text-tint-success-foreground",
  },
};

/**
 * The one sentence a widget adds on top of its list: what the numbers
 * mean, or what to do about them ("Approving this unblocks Order pizza").
 * Bold the few words that matter with <b>.
 */
export function Insight({
  children,
  tone = "plain",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: InsightTone;
  /** A different icon than the tone's (Clock for time, Wallet for money). */
  icon?: IconComponent;
  className?: string;
}) {
  const { Icon: ToneIcon, box, dot } = INSIGHT_TONE[tone];
  const Icon = icon ?? ToneIcon;
  return (
    <p
      className={cn(
        "rounded-tile flex items-start gap-2.5 px-3.5 py-3 text-[13.5px] leading-snug [&_b]:font-semibold",
        box,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-px grid size-5.5 shrink-0 place-items-center rounded-full", dot)}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
