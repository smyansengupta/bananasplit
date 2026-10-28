import {
  Check,
  Crown,
  GraduationCap,
  ScanLine,
  FileText,
  HandCoins,
  Receipt,
  Send,
  Stamp,
  UserPlus,
  Users,
} from "@/components/icons";
import { cn } from "@/lib/utils";

import { Chip, Stage } from "./feature-art";

/*
 * What each kind of organization's workspace looks like, drawn like the
 * feature illustrations: a soft backdrop, the one view that team lives in,
 * and a few things happening around it. Decoration: callers mark them
 * aria-hidden.
 */

/** A white card holding the main view. */
function Board({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "bg-card absolute flex flex-col gap-3 rounded-[18px] p-4 shadow-[var(--elevation-2)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A thin progress bar; `value` is 0 to 100. */
function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <span className="bg-foreground/10 block h-1.5 w-full overflow-hidden rounded-full">
      <span
        className={cn("block h-full rounded-full", className ?? "bg-foreground")}
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

const ROADMAP = [
  { name: "Onboarding", start: 0, span: 45, tone: "bg-(--tag-navy)" },
  { name: "Billing v2", start: 25, span: 50, tone: "bg-banana" },
  { name: "Mobile app", start: 55, span: 45, tone: "bg-(--tag-forest)" },
] as const;

/** Startups: the quarter's roadmap, a spec turning into tasks, a new hire joining. */
export function StartupArt() {
  return (
    <Stage tone="bg-(--tag-teal)/12" size="lg">
      <Board className="top-8 right-[6%] left-[6%] sm:right-[14%]">
        <span className="flex items-center justify-between text-[13px] font-semibold">
          Q4 roadmap
          <span className="text-muted-foreground text-[11px] font-medium">Oct · Nov · Dec</span>
        </span>
        <div className="flex flex-col gap-2.5">
          {ROADMAP.map(({ name, start, span, tone }) => (
            <span key={name} className="grid grid-cols-[82px_1fr] items-center gap-3">
              <span className="text-foreground/75 truncate text-[11.5px]">{name}</span>
              <span className="bg-muted relative h-5 rounded-[6px]">
                <span
                  className={cn("absolute inset-y-0 rounded-[6px]", tone)}
                  style={{ left: `${start}%`, width: `${span}%` }}
                />
              </span>
            </span>
          ))}
        </div>
      </Board>
      <Chip className="bottom-[26%] left-[8%] -rotate-2">
        <FileText className="size-4" />
        Spec → 6 tasks
      </Chip>
      <Chip className="right-[8%] bottom-[10%] rotate-1">
        <UserPlus className="size-4" />
        Priya joined · set up in 2 min
      </Chip>
    </Stage>
  );
}

/** Nonprofits: a volunteer drive filling up, the grant it's spent from, a receipt filed. */
export function NonprofitArt() {
  return (
    <Stage tone="bg-(--tag-forest)/12" size="lg">
      <Board className="top-8 left-[6%] w-[62%] max-w-[300px]">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Users className="size-4" /> Saturday food drive
        </span>
        <span className="flex items-baseline justify-between text-[11.5px]">
          <span className="text-foreground/75">Volunteers</span>
          <span className="font-semibold tabular-nums">42 / 50</span>
        </span>
        <Bar value={84} className="bg-(--tag-forest)" />
        <span className="text-muted-foreground text-[11px]">8 on the waitlist · reminders on</span>
      </Board>
      <Board className="right-[6%] bottom-[14%] w-[52%] max-w-[250px] gap-2 p-3.5">
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <HandCoins className="size-4" /> Community grant
        </span>
        <span className="numeral text-[26px] leading-none">$12,400</span>
        <span className="text-muted-foreground text-[11px]">left of $20,000</span>
        <Bar value={62} />
      </Board>
      <Chip className="bottom-[10%] left-[8%] -rotate-2">
        <Receipt className="size-4" />
        Receipt filed · $86.20
      </Chip>
    </Stage>
  );
}

const CLIENTS = [
  { name: "Acme rebrand", done: 72, spent: "$18.2k of $24k" },
  { name: "Kite app", done: 40, spent: "$9.6k of $30k" },
  { name: "Lumen site", done: 90, spent: "$11.1k of $12k" },
] as const;

/** Agencies: every client's progress and spend, a doc approved, an invoice out. */
export function AgencyArt() {
  return (
    <Stage tone="bg-(--tag-ochre)/12" size="lg">
      <Board className="top-8 right-[6%] left-[6%] gap-3.5 sm:right-[16%]">
        <span className="text-[13px] font-semibold">Clients</span>
        {CLIENTS.map(({ name, done, spent }) => (
          <span key={name} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-3 text-[11.5px]">
              <span className="font-semibold">{name}</span>
              <span className="text-muted-foreground tabular-nums">{spent}</span>
            </span>
            <Bar value={done} />
          </span>
        ))}
      </Board>
      <Chip className="bottom-[9%] left-[7%] -rotate-2">
        <Stamp className="size-4" />
        <Check className="-ml-1 size-3.5 text-(--tag-forest)" strokeWidth={3} />
        Client approved the brief
      </Chip>
      <Chip className="right-[7%] bottom-[22%] rotate-2">
        <Send className="size-4" />
        Invoice sent · $8,500
      </Chip>
    </Stage>
  );
}

/** Clubs: tonight's meeting checking in, dues coming in, next year's officers ready. */
export function ClubArt() {
  return (
    <Stage tone="bg-(--tag-rust)/12" size="lg">
      <Board className="top-8 left-[6%] w-[64%] max-w-[300px]">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <GraduationCap className="size-4" /> Robotics Club · Tue 6 PM
        </span>
        <span className="flex items-baseline justify-between text-[11.5px]">
          <span className="text-foreground/75">Checked in</span>
          <span className="font-semibold tabular-nums">28 / 34</span>
        </span>
        <Bar value={82} className="bg-banana" />
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <ScanLine className="size-3.5" /> QR check-in at the door
        </span>
      </Board>
      <Board className="right-[6%] bottom-[16%] w-[48%] max-w-[230px] gap-2 p-3.5">
        <span className="text-[12px] font-semibold">Spring dues</span>
        <span className="numeral text-[26px] leading-none">31 of 34</span>
        <span className="text-muted-foreground text-[11px]">paid · $1,240 in</span>
      </Board>
      <Chip className="bottom-[9%] left-[8%] -rotate-2">
        <Crown className="size-4" />
        Handoff to 2027 officers ready
      </Chip>
    </Stage>
  );
}
