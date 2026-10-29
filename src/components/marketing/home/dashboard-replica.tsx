"use client";

import {
  Bell,
  CalendarDays,
  CircleAlert,
  Database,
  Folder,
  LayoutGrid,
  MessageCircle,
  NotebookText,
  Plus,
  Search,
  SlidersHorizontal,
  SquareCheckBig,
  Users,
  Video,
  Wallet,
  type IconComponent,
} from "@/components/icons";

import { Logo } from "@/components/brand/logo";
import { sidebarItemClass } from "@/components/shell/sidebar-nav";
import { Badge } from "@/components/ui/badge";
import { BlockCard } from "@/components/ui/block-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { TagChip } from "@/components/ui/chip";
import { Stat, StatStrip } from "@/components/ui/stat";
import { cn } from "@/lib/utils";

/**
 * A workspace's Overview, drawn with the app's own pieces (the sidebar's
 * item class, the tool capsule, the stat strip, Up next's block cards, the
 * board's cards) and sample data, for the marketing screenshot
 * (public/marketing/dashboard-light.png, taken from /dev/dashboard). No
 * database, no session: what a new organization's Overview looks like a
 * few weeks in.
 */

const NAV: readonly { icon: IconComponent; label: string; active?: boolean }[] = [
  { icon: LayoutGrid, label: "Overview", active: true },
  { icon: SquareCheckBig, label: "Tasks" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: Video, label: "Meetings" },
  { icon: NotebookText, label: "Notes" },
];
const DATA: readonly { icon: IconComponent; label: string }[] = [
  { icon: Users, label: "People" },
  { icon: Folder, label: "Files" },
  { icon: Database, label: "Databases" },
  { icon: Wallet, label: "Finance" },
];

function Sidebar() {
  return (
    <aside className="bg-sidebar border-sidebar-border flex w-[248px] shrink-0 flex-col border-r p-4">
      <div className="flex items-center gap-3 pb-3">
        <span className="bg-foreground text-background grid size-10 place-items-center rounded-full text-[13px] font-bold">
          NL
        </span>
        <span className="flex-1 truncate text-[15px] font-semibold">Northwind Labs</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ icon: Icon, label, active }) => (
          <span
            key={label}
            className={sidebarItemClass({ active: Boolean(active), rail: false, chrome: false })}
          >
            <Icon className="size-5 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
          </span>
        ))}
        <span className="text-sidebar-foreground/60 h-[34px] pt-3 pl-3 text-[13px] font-medium">
          Data
        </span>
        {DATA.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className={sidebarItemClass({ active: false, rail: false, chrome: false })}
          >
            <Icon className="size-5 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
          </span>
        ))}
      </nav>
      <div className="border-sidebar-border mt-auto flex items-center border-t pt-3">
        <Logo size={22} textSize={17} />
      </div>
    </aside>
  );
}

function Capsule() {
  return (
    <div className="flex justify-end px-6 pt-3.5">
      <div className="glass-light flex w-[30rem] items-center gap-0.5 rounded-full p-1">
        <span className="text-muted-foreground flex h-10 flex-1 items-center gap-2.5 rounded-full px-3.5 text-sm">
          <Search className="size-[18px]" strokeWidth={1.75} />
          Search tasks, people, files…
          <kbd className="bg-background text-muted-foreground ms-auto rounded-md px-1.5 py-1 font-mono text-[11px] leading-none">
            ⌘K
          </kbd>
        </span>
        <span className="bg-border mx-1 h-[22px] w-px" />
        {[Plus, Bell].map((Icon, i) => (
          <span key={i} className="grid size-10 place-items-center rounded-full">
            <Icon className="size-[18px]" />
          </span>
        ))}
        <span className="bg-tint-info text-tint-info-foreground grid size-9 place-items-center rounded-full text-[12px] font-bold">
          MC
        </span>
      </div>
    </div>
  );
}

function Faces({ initials }: { initials: readonly string[] }) {
  return (
    <span className="flex items-center">
      {initials.map((v, i) => (
        <span
          key={v}
          className={cn(
            "grid size-8 place-items-center rounded-full bg-[color-mix(in_oklab,currentColor_18%,var(--ring-bg,var(--card)))] text-[11px] font-bold ring-2 ring-(--ring-bg,var(--card))",
            i > 0 && "-ml-2",
          )}
        >
          {v}
        </span>
      ))}
    </span>
  );
}

const TASKS = [
  {
    title: "Send the Acme proposal",
    epic: "Fall launch",
    tone: "var(--tag-navy)",
    due: "Due Fri",
    via: true,
  },
  {
    title: "Book the venue for the showcase",
    epic: "Events",
    tone: "var(--tag-forest)",
    due: "Due tomorrow",
  },
  {
    title: "Review the Q4 budget",
    epic: "Finance",
    tone: "var(--tag-plum)",
    due: "Due today",
    today: true,
  },
  { title: "Draft the onboarding doc", epic: "People", tone: "var(--tag-teal)", due: "Due Mon" },
];

const WEEK = [
  { day: "Mon", date: 26, events: [{ time: "10:00 AM", title: "Standup" }] },
  {
    day: "Today",
    date: 27,
    today: true,
    events: [
      { time: "10:00 AM", title: "Standup · moved" },
      { time: "2:00 PM", title: "Design review" },
    ],
  },
  { day: "Wed", date: 28, events: [] },
  { day: "Thu", date: 29, events: [{ time: "6:00 PM", title: "Fall showcase" }] },
  { day: "Fri", date: 30, events: [{ time: "12:00 PM", title: "All-hands" }] },
  { day: "Sat", date: 31, events: [] },
  { day: "Sun", date: 1, events: [] },
];

export function DashboardReplica() {
  return (
    <div className="corona bg-background text-foreground flex h-[860px] w-[1440px] overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Capsule />
        <main className="flex min-w-0 flex-col gap-8 px-8 pt-2">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="display-title m-0 text-[56px] leading-none tracking-[-0.04em]">
                Good morning, Maya
              </h1>
              <p className="text-muted-foreground mt-3 text-[17px]">
                Tuesday, October 27 · Northwind Labs
              </p>
            </div>
            <span className="border-input flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold">
              <SlidersHorizontal className="size-4" />
              Customize
            </span>
          </div>

          <StatStrip>
            <Stat
              icon={SquareCheckBig}
              value={6}
              label="Due this week"
              chip={<Badge variant="accent">2 due today</Badge>}
            />
            <Stat
              icon={CircleAlert}
              value={0}
              label="Overdue"
              chip={<Badge variant="success">All clear</Badge>}
            />
            <Stat icon={CalendarDays} value={9} label="Coming up in 14 days" />
            <Stat
              icon={MessageCircle}
              value={18}
              label="Done by text this week"
              chip={<Badge variant="info">iMessage</Badge>}
            />
          </StatStrip>

          <section>
            <div className="mb-4 flex items-center gap-2.5">
              <h2 className="heading text-[17px]">Up next</h2>
              <span className="text-muted-foreground text-sm">The next 7 days</span>
            </div>
            <div className="grid grid-cols-4 gap-3.5">
              <BlockCard
                tone="quiet"
                accent="var(--tag-navy)"
                kicker="Today · 2:00 PM"
                title="Design review"
                subtitle="Zoom · link in the invite"
                aside={<Faces initials={["MC", "JP", "SO"]} />}
              />
              <BlockCard
                tone="alert"
                kicker="Due today"
                title="Review the Q4 budget"
                subtitle="Finance"
                figure="$12,400"
                figureLabel="left this quarter"
              />
              <BlockCard
                tone="answer"
                kicker="Your answer"
                title="Offsite dates"
                subtitle="Pick the days you can make"
                figure="6 of 9"
                figureLabel="have voted"
              />
              <BlockCard
                tone="goal"
                kicker="Thu · 6:00 PM"
                title="Fall showcase"
                subtitle="Main hall"
                figure="42 of 50"
                figureLabel="going"
                aside={<Faces initials={["AK", "LS", "OW"]} />}
              />
            </div>
          </section>

          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-5 gap-3">
              <CardHeader className="flex items-center gap-2">
                <CardTitle>My tasks</CardTitle>
                <Badge variant="secondary">4</Badge>
              </CardHeader>
              <ul className="m-0 list-none px-6">
                {TASKS.map((t, i) => (
                  <li
                    key={t.title}
                    className={cn(
                      "relative flex items-center gap-3.5 py-3",
                      i > 0 &&
                        "before:bg-border before:absolute before:top-0 before:right-0 before:left-9 before:h-px",
                    )}
                  >
                    <span className="border-foreground/25 size-5 flex-none rounded-full border-[1.5px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{t.title}</span>
                      <span className="mt-1 flex items-center gap-2.5 text-[13px]">
                        <TagChip color={t.tone}>{t.epic}</TagChip>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            t.today
                              ? "text-tint-danger-foreground font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          <CalendarDays className="size-3.5" />
                          {t.due}
                        </span>
                        {t.via && (
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <MessageCircle className="size-3.5" />
                            Added by text
                          </span>
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="col-span-7 gap-3">
              <CardHeader className="flex items-center gap-2">
                <CardTitle>This week</CardTitle>
                <Badge variant="secondary">5</Badge>
              </CardHeader>
              <ol className="m-0 grid list-none grid-cols-7 gap-2 px-6">
                {WEEK.map((d) => (
                  <li
                    key={d.day}
                    className={cn(
                      "rounded-tile flex min-h-36 min-w-0 flex-col gap-2 p-2.5",
                      d.today
                        ? "bg-brand-accent text-brand-accent-foreground glow-halo"
                        : "bg-muted/60",
                    )}
                  >
                    <span className="flex items-baseline gap-1">
                      <span
                        className={cn(
                          "text-[12px] font-medium",
                          !d.today && "text-muted-foreground",
                        )}
                      >
                        {d.day}
                      </span>
                      <span className="numeral text-[18px]">{d.date}</span>
                    </span>
                    {d.events.length === 0 && (
                      <span className="text-muted-foreground text-[11px]">Free</span>
                    )}
                    {d.events.map((e) => (
                      <span
                        key={e.title}
                        className={cn(
                          "block rounded-[9px] px-1.5 py-1 text-[11px] leading-tight",
                          d.today ? "bg-black/10" : "bg-card",
                        )}
                      >
                        <span className="block opacity-70">{e.time}</span>
                        <span className="line-clamp-2 font-semibold">{e.title}</span>
                      </span>
                    ))}
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
