import {
  CalendarDays,
  ChartGantt,
  Columns3,
  Gauge,
  ListTree,
  type IconComponent,
  Search,
  Table2,
} from "@/components/icons";

import { ArrowRight } from "@/components/brand/arrows";
import { CoreMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { type Avatar, AvatarStack } from "./avatar-stack";
import { SectionIntro } from "./section-title";

/** The apps a club board juggles today, crossed out on the way in. */
const REPLACED_APPS = [
  "Luma",
  "When2meet",
  "Trello",
  "Budget spreadsheet",
  "Receipts in the group chat",
  "Airtable",
  "Google Drive",
] as const;

/** Tasks' six layouts, each with what it is for. */
const TASK_VIEWS: readonly { name: string; icon: IconComponent; body: string }[] = [
  { name: "Board", icon: Columns3, body: "Drag work from To do to Done and spot what's stuck." },
  {
    name: "Week",
    icon: CalendarDays,
    body: "Every deadline on a seven-day strip, so nothing sneaks up.",
  },
  {
    name: "List",
    icon: ListTree,
    body: "Epics, stories and tasks nested, with progress rolling up.",
  },
  { name: "Table", icon: Table2, body: "Filter, sort and bulk-edit fifty tasks in one go." },
  { name: "Roadmap", icon: ChartGantt, body: "The semester's plan on one timeline, epic by epic." },
  { name: "Dashboard", icon: Gauge, body: "What's overdue, who's overloaded, what got done." },
];

/** The Overview sample's Up next row: one block per meaning (act now, your answer, coming up). */
const UP_NEXT = [
  {
    kicker: "Due today",
    title: "Send the GBM agenda",
    tone: "bg-brick text-cream",
    meta: "text-cream/75",
  },
  {
    kicker: "Your vote",
    title: "Showcase T-shirt colour",
    tone: "bg-banana text-ink",
    meta: "text-honey-deep",
    ticks: 9,
  },
  {
    kicker: "Thu · 6:00 PM",
    title: "Build night",
    tone: "bg-ink text-cream",
    meta: "text-dusk",
    going: true,
  },
] as const;

/** What the AI made from one typed line: an event and two assigned tasks. */
const CHAT_RESULTS = [
  { kind: "Event", text: "Spring Showcase, Apr 12" },
  { kind: "Task", text: "Book the venue", who: "Maya" },
  { kind: "Task", text: "Snacks", who: "Jay" },
] as const;

/** A week on the calendar: day tiles, today in ink, events as pills (solid when you're going). */
const WEEK = [
  { day: "Mon", date: 12 },
  { day: "Tue", date: 13, today: true, event: "Build night", going: true },
  { day: "Wed", date: 14 },
  { day: "Thu", date: 15, event: "GBM", going: true },
  { day: "Fri", date: 16, event: "Social" },
] as const;

/** Find a time answers, morning to evening by weekday: 0 (nobody free) to 3 (most of the club). */
const HEAT = [
  [1, 0, 2, 1, 0],
  [2, 1, 2, 2, 1],
  [1, 2, 3, 3, 2],
] as const;
const HEAT_TONES = ["bg-sand", "bg-butter", "bg-lemon", "bg-gold"] as const;

/** Seats on the sample event, one tick per five. */
const SEAT_TICKS = 20;
const SEATS_TAKEN = 17;

/** A few rows of a club database: tags in team colours, numbers on the right. */
const ROSTER = [
  { name: "Maya Patel", team: "Build", tone: "bg-butter text-honey-deep", visits: 12 },
  { name: "Jay Ortiz", team: "Events", tone: "bg-leaf text-leaf-ink", visits: 9 },
  { name: "Sam Lee", team: "Treasury", tone: "bg-sand text-ink-soft", visits: 7 },
] as const;

const RSVPS: readonly Avatar[] = [
  { tone: "bg-banana" },
  { tone: "bg-wheat" },
  { tone: "bg-spot" },
  { tone: "bg-ink" },
];

const EDITORS: readonly Avatar[] = [
  { tone: "bg-banana", initial: "A" },
  { tone: "bg-wheat", initial: "M" },
  { tone: "bg-ink text-cream", initial: "J" },
];

const DATA_SOURCES = [
  "Google Sheets",
  "Airtable",
  "Notion",
  "Excel",
  "Supabase",
  "Postgres",
  "CSV import",
] as const;

/** Theme presets as small cards: the first is the one chosen (Moonstone, with its banana glow). */
const THEME_PRESETS = [
  { name: "Moonstone", tone: "bg-ink", glow: true },
  { name: "Harbor", tone: "bg-navy" },
  { name: "Evergreen", tone: "bg-pine" },
  { name: "Coral", tone: "bg-brick" },
] as const;

const PINNED = ["Budget", "Showcase tasks", "Meeting notes"] as const;

const TEAMS = [
  { team: "Events", initial: "J" },
  { team: "Treasury", initial: "S" },
] as const;

/** The white tiles: paper, a hairline and the soft card shadow. */
const PAPER_TILE = "rounded-[28px] border border-ink/8 bg-paper shadow-card";

/**
 * On phones the tiles are one swipeable row instead of a long stack: each
 * tile is most of the screen wide, so the next one peeks in, and snaps into
 * place.
 */
const SLIDE = "max-sm:w-[86%] max-sm:flex-none max-sm:snap-start";

/** A row of tiles; on phones its tiles join the one swipeable row. */
const ROW = "flex flex-wrap gap-4 max-sm:contents";

/** The two-column tiles: copy beside a sample, stacked once two 260px columns don't fit. */
const SPLIT_TILE =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] items-center gap-7 p-[clamp(24px,3vw,40px)] max-sm:content-start max-sm:gap-5";

/** Each tile surface's label colour. */
const LABEL_TONES = {
  paper: "text-ink-faint",
  sand: "text-ink-soft",
  banana: "text-honey-deep",
  butter: "text-honey",
  ink: "text-banana",
} as const;

/**
 * A tile's small label, with the app it replaces as a tag on the right of
 * the row (wrapping below it when the tile is narrow).
 */
function TileTitle({
  children,
  replaces,
  tone = "paper",
}: {
  children: React.ReactNode;
  replaces?: string;
  tone?: keyof typeof LABEL_TONES;
}) {
  const label = (
    <span
      className={cn(
        "relative inline-flex items-center gap-2 text-[15px] font-bold tracking-[-0.005em]",
        LABEL_TONES[tone],
      )}
    >
      {children}
    </span>
  );
  if (!replaces) return label;
  return (
    <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      {label}
      <span
        className={cn(
          "rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap",
          tone === "banana" ? "bg-paper/60 text-honey-dark" : "bg-ink/5 text-ink-soft",
        )}
      >
        Replaces {replaces}
      </span>
    </div>
  );
}

/**
 * "Every scoop your club needs.": the apps it replaces, then a bento of
 * features (a swipeable row on phones).
 */
export function FeatureBoard() {
  return (
    <section
      id="features"
      className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 pt-20 pb-16 sm:gap-14 sm:pt-32 sm:pb-28"
    >
      <SectionIntro title="Every scoop your club needs." className="max-w-[380px] text-pretty">
        Most clubs juggle seven apps, each with its own login and member list. Bananasplit puts
        events, money and data in one workspace with one member list and one bill.
      </SectionIntro>

      <div className="-mt-4 flex flex-wrap items-center gap-1.5 sm:-mt-6 sm:gap-2">
        {REPLACED_APPS.map((app) => (
          <span
            key={app}
            className="bg-sand text-ink-faint rounded-full px-2.5 py-1 text-[13px] line-through sm:px-3 sm:py-1.5 sm:text-[14px]"
          >
            {app}
          </span>
        ))}
        <span className="text-core flex px-1">
          <ArrowRight />
        </span>
        <span className="bg-ink text-cream inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-[13px] font-bold sm:py-1.5 sm:pr-3.5 sm:pl-2 sm:text-[14px]">
          <CoreMark size={18} />
          One workspace
        </span>
      </div>

      <div className="flex flex-col gap-4 max-sm:-mx-6 max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-6 max-sm:[scrollbar-width:none] max-sm:flex-row max-sm:items-start max-sm:gap-3 max-sm:overflow-x-auto max-sm:px-6 max-sm:pb-1">
        <div className={ROW}>
          <OverviewTile />
          <CalendarTile />
        </div>
        <div className={ROW}>
          <TasksTile />
        </div>
        <div className={ROW}>
          <EventsTile />
          <AiTile />
        </div>
        <div className={ROW}>
          <NotesTile />
          <DatabasesTile />
        </div>
        <div className={ROW}>
          <CustomizationTile />
          <PeopleTile />
        </div>
      </div>
    </section>
  );
}

/** The wide tile; a sample home board bleeds off its bottom-right corner. */
function OverviewTile() {
  return (
    <div
      className={cn(
        PAPER_TILE,
        SLIDE,
        "flex flex-[2_1_560px] flex-col gap-4 overflow-hidden p-[clamp(24px,3vw,40px)]",
      )}
    >
      <TileTitle>Overview</TileTitle>
      <h3 className="font-heading max-w-[560px] text-[clamp(28px,3.4vw,46px)] leading-[1.05] tracking-[-0.025em] text-balance">
        Open the app and know what to do next.
      </h3>
      <p className="text-ink-muted max-w-[500px] text-[15px] leading-[1.55] text-pretty sm:text-[16px]">
        Up next puts what needs you first: the task due today, the vote waiting on you, the next
        meeting. Every Friday the weekly pulse tells the whole club what got done.
      </p>
      <HomeBoardSample />
    </div>
  );
}

/** A member's home board, drawn small: greeting, three numbers and the Up next row. */
function HomeBoardSample() {
  return (
    <div
      aria-hidden="true"
      className="border-ink/10 bg-cream mt-auto -mr-[clamp(24px,3vw,40px)] -mb-[clamp(24px,3vw,40px)] ml-[clamp(0px,2vw,24px)] flex flex-col gap-4 rounded-tl-[22px] border-t border-l p-[clamp(16px,2vw,24px)]"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-heading text-[22px] leading-tight tracking-[-0.02em]">
          Good morning, Maya
        </span>
        <span className="text-ink-soft text-[12px]">Tuesday, October 13 · Riverside Robotics</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
        <span className="flex items-baseline gap-1.5">
          <b className="font-heading text-[22px]">6</b> open tasks
          <span className="bg-butter text-honey-deep rounded-full px-2 py-0.5 font-semibold">
            1 due today
          </span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <b className="font-heading text-[22px]">0</b> overdue
          <span className="bg-leaf text-leaf-ink rounded-full px-2 py-0.5 font-semibold">
            All clear
          </span>
        </span>
        <span className="flex items-baseline gap-1.5 max-sm:hidden">
          <b className="font-heading text-[22px]">7:00</b> GBM tonight
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 max-sm:grid-cols-2">
        {UP_NEXT.map((block, i) => (
          <div
            key={block.title}
            className={cn(
              "flex min-h-[132px] flex-col gap-1.5 rounded-[18px] p-3.5",
              block.tone,
              i === 2 && "max-sm:hidden",
            )}
          >
            <span className={cn("text-[11px] font-semibold", block.meta)}>{block.kicker}</span>
            <span className="font-heading text-[17px] leading-[1.15] tracking-[-0.015em]">
              {block.title}
            </span>
            {"ticks" in block && (
              <span className="mt-auto flex gap-[3px]">
                {Array.from({ length: 12 }, (_, t) => (
                  <span
                    key={t}
                    className={cn(
                      "h-2 flex-1 rounded-full",
                      t < block.ticks ? "bg-ink" : "bg-ink/20",
                    )}
                  />
                ))}
              </span>
            )}
            {"going" in block && (
              <span className="mt-auto flex items-center gap-1.5 text-[11px]">
                <AvatarStack
                  avatars={RSVPS.slice(0, 3)}
                  itemClassName="border-ink size-5"
                  overlap="-ml-1.5"
                />
                <span className={block.meta}>12 going</span>
              </span>
            )}
            {!("ticks" in block) && !("going" in block) && (
              <span className={cn("mt-auto text-[11px]", block.meta)}>Club operations</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The banana tile across the board: six layouts of one task list, each with what it's for. */
function TasksTile() {
  return (
    <div
      className={cn(
        SLIDE,
        "bg-banana relative grid flex-[1_1_100%] grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-10 gap-y-7 overflow-hidden rounded-[28px] p-6 sm:p-10",
      )}
    >
      <span
        aria-hidden="true"
        className="bg-glow-cream absolute -top-16 -left-16 size-[260px] rounded-full"
      />
      <div className="relative flex flex-col gap-4">
        <TileTitle tone="banana" replaces="Trello">
          Tasks
        </TileTitle>
        <div className="flex items-end gap-3.5">
          <span className="font-heading text-[clamp(96px,9vw,128px)] leading-[0.78] tracking-[-0.05em]">
            {TASK_VIEWS.length}
          </span>
          <span className="pb-0.5 text-[19px] leading-[1.25] font-semibold">
            ways to see
            <br />
            the same work
          </span>
        </div>
        <p className="text-bark max-w-[420px] text-[16px] leading-[1.55] text-pretty">
          Assign it once and everyone sees it the way they work best. Break big goals into epics and
          stories, type <b>#tag</b> to tag as you go, and close a task with one tap (and Undo). Less
          chasing, fewer meetings about meetings.
        </p>
        <div className="mt-auto flex flex-wrap gap-1.5 max-sm:hidden">
          {[
            "Projects with leads",
            "Epics and stories",
            "#tags as you type",
            "Due-date reminders",
          ].map((perk) => (
            <span
              key={perk}
              className="bg-paper/60 rounded-full px-[11px] py-[5px] text-[13px] font-semibold"
            >
              {perk}
            </span>
          ))}
        </div>
      </div>
      <ul className="relative m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2.5 p-0">
        {TASK_VIEWS.map(({ name, icon: Icon, body }) => (
          <li key={name} className="bg-paper/55 flex flex-col gap-1.5 rounded-[18px] p-4">
            <span className="flex items-center gap-2 text-[15px] font-bold">
              <span className="bg-paper grid size-7 place-items-center rounded-full">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              {name}
            </span>
            <span className="text-bark text-[13.5px] leading-[1.45]">{body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalendarTile() {
  return (
    <div className={cn(PAPER_TILE, SLIDE, "flex flex-[1_1_320px] flex-col gap-2.5 p-6 sm:p-8")}>
      <TileTitle replaces="When2meet">Calendar</TileTitle>
      <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden="true">
        {WEEK.map((d) => (
          <div
            key={d.day}
            className={cn(
              "flex min-h-[78px] flex-col gap-1 rounded-[14px] p-2",
              "today" in d ? "bg-ink text-cream" : "bg-cream",
            )}
          >
            <span className="text-[11px] font-semibold opacity-70">{d.day}</span>
            <span className="text-[16px] leading-none font-bold">{d.date}</span>
            {"event" in d && (
              <span
                className={cn(
                  "mt-auto truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  "going" in d ? "bg-banana text-ink" : "bg-butter text-honey-deep",
                )}
              >
                {d.event}
              </span>
            )}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="bg-cream flex flex-col gap-2 rounded-[18px] p-3.5">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="font-semibold">Find a time · 14 answered</span>
          <span className="bg-banana text-ink rounded-full px-2 py-0.5 font-bold">
            Best: Thu 6 PM
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {HEAT.flatMap((row, r) =>
            row.map((level, c) => (
              <span
                key={`${r}-${c}`}
                className={cn(
                  "h-4 rounded-[5px]",
                  HEAT_TONES[level],
                  r === 2 && c === 3 && "outline-ink outline-2 outline-offset-1",
                )}
              />
            )),
          )}
        </div>
      </div>
      <div className="font-heading mt-auto text-[clamp(28px,2.6vw,36px)] leading-[1.05] tracking-[-0.025em]">
        Find a time in one link. Book it for everyone.
      </div>
      <p className="text-ink-muted text-[15px] leading-[1.55] text-pretty">
        Send a poll, watch the best time light up, and book it. Meetings sync both ways with Google
        Calendar, and every member gets their own feed.
      </p>
    </div>
  );
}

/** RSVPs and events, with a sample event card. */
function EventsTile() {
  return (
    <div className={cn(PAPER_TILE, SPLIT_TILE, SLIDE, "flex-[1.6_1_460px]")}>
      <div className="flex flex-col gap-3.5">
        <TileTitle>RSVPs and events</TileTitle>
        <h3 className="font-heading text-[clamp(32px,3.4vw,46px)] leading-[1.04] tracking-[-0.025em] text-balance">
          RSVPs, built right in.
        </h3>
        <p className="text-ink-muted text-[16px] leading-[1.55] text-pretty">
          Publish an event page in a minute. Sign-ups fill to capacity, the waitlist moves up on its
          own, reminders go out for you, and QR check-in at the door takes seconds. Every guest
          joins your member list, so you see who keeps coming back.
        </p>
      </div>
      <div className="border-ink/8 bg-cream flex flex-col gap-3.5 rounded-[24px] border p-[18px] max-sm:gap-3 max-sm:p-3.5">
        <div className="bg-event-cover flex h-24 items-end rounded-[16px] p-3 max-sm:hidden">
          <span className="bg-paper/85 rounded-full px-2.5 py-[3px] text-[12px] font-semibold">
            Fri · 7:00 PM
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[17px] font-bold">Spring Showcase</span>
          <span className="text-ink-soft text-[13px]">Student Union, Room 204</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-[3px]" aria-hidden="true">
            {Array.from({ length: SEAT_TICKS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-3 flex-1 rounded-full",
                  i < SEATS_TAKEN ? "bg-banana" : "bg-straw",
                )}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <AvatarStack
              avatars={RSVPS.slice(0, 3)}
              itemClassName="border-cream size-6"
              overlap="-ml-2"
            />
            <span className="text-[13px] font-semibold whitespace-nowrap">86 of 100 going</span>
            <span className="text-ink-soft text-[13px] whitespace-nowrap">· 12 on waitlist</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-ink-soft text-[12px] font-semibold">Your answer</span>
          <div className="bg-sand flex gap-1 rounded-full p-1 text-[13px] font-semibold">
            <span className="bg-ink text-cream flex-1 rounded-full py-2 text-center">Going</span>
            <span className="text-ink-soft flex-1 py-2 text-center">Maybe</span>
            <span className="text-ink-soft flex-1 py-2 text-center">Can&apos;t</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The dark tile: a typed request turned into an event and tasks. */
function AiTile() {
  return (
    <div
      className={cn(
        SLIDE,
        "bg-ink text-cream relative flex flex-[1_1_320px] flex-col gap-3.5 overflow-hidden rounded-[28px] p-6 sm:p-8",
      )}
    >
      <span
        aria-hidden="true"
        className="bg-glow-banana absolute -top-20 -right-20 size-[280px] rounded-full"
      />
      <TileTitle tone="ink">AI built in</TileTitle>
      <h3 className="font-heading relative text-[clamp(30px,3vw,40px)] leading-[1.05] tracking-[-0.025em] text-balance">
        Type it. It&apos;s sorted.
      </h3>
      <div className="relative my-1.5 flex flex-col gap-2">
        <span className="bg-banana text-ink max-w-[90%] self-end rounded-[16px_16px_4px_16px] px-3.5 py-2.5 text-[14px] leading-[1.45]">
          Showcase is April 12. Maya books the venue, Jay does snacks.
        </span>
        <div className="border-cream/10 bg-cream/8 flex w-[90%] flex-col gap-1.5 self-start rounded-[16px_16px_16px_4px] border p-3">
          {CHAT_RESULTS.map((result) => (
            <span key={result.text} className="flex items-center gap-2 text-[13px]">
              <span className="bg-banana text-ink grid size-[18px] flex-none place-items-center rounded-full text-[10px] font-bold">
                ✓
              </span>
              <span className="bg-cream/12 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                {result.kind}
              </span>
              <span className="truncate">{result.text}</span>
              {"who" in result && (
                <span className="text-dusk whitespace-nowrap">→ {result.who}</span>
              )}
            </span>
          ))}
        </div>
      </div>
      <p className="text-dusk relative mt-auto text-[15px] leading-[1.55] text-pretty">
        Say what needs doing and it becomes events and assigned tasks. AI also turns a screenshot
        into calendar events, tidies databases and drafts the org chart, with the model you choose.
      </p>
    </div>
  );
}

function NotesTile() {
  return (
    <div
      className={cn(
        PAPER_TILE,
        SLIDE,
        "flex flex-[1_1_280px] flex-col gap-3 p-6 sm:min-h-80 sm:p-8",
      )}
    >
      <TileTitle replaces="Google Drive">Files and notes</TileTitle>
      <div
        aria-hidden="true"
        className="border-ink/8 bg-cream mt-2 flex flex-col gap-2.5 rounded-[18px] border p-3.5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="bg-sand flex gap-0.5 rounded-full p-0.5 text-[11px] font-semibold">
            <span className="bg-paper shadow-segment rounded-full px-2.5 py-1">Page</span>
            <span className="text-ink-soft px-2.5 py-1">Document</span>
          </div>
          <AvatarStack
            avatars={EDITORS}
            itemClassName="border-cream grid size-6 place-items-center text-[10px] font-bold"
            overlap="-ml-1.5"
          />
        </div>
        <span className="text-[14px] font-bold">GBM agenda</span>
        <span className="text-[12px] leading-[1.5]">
          Book the venue <span className="bg-butter rounded px-0.5">by Friday</span>, then send the
          flyer.
        </span>
        <span className="border-ink/8 bg-paper self-end rounded-[12px_12px_4px_12px] border px-2.5 py-1.5 text-[12px]">
          <b>Jay</b> On it, asking the SU today
        </span>
      </div>
      <div className="font-heading mt-auto text-[clamp(36px,3.8vw,50px)] leading-[0.98] tracking-[-0.03em]">
        Edit together, live.
      </div>
      <p className="text-ink-muted text-[15px] leading-[1.55] text-pretty">
        Pages that nest like Notion or documents like Google Docs, with comments, version history
        and storage that stays put when officers graduate.
      </p>
    </div>
  );
}

function DatabasesTile() {
  return (
    <div
      className={cn(
        SLIDE,
        "bg-sand flex flex-[1.5_1_400px] flex-col gap-3.5 rounded-[28px] p-6 sm:p-8",
      )}
    >
      <TileTitle tone="sand" replaces="Airtable and spreadsheets">
        Databases
      </TileTitle>
      <h3 className="font-heading max-w-[460px] text-[clamp(26px,2.4vw,32px)] leading-[1.1] tracking-[-0.025em] text-balance">
        Attendance, sign-ups and ballots, connected to the data you already have.
      </h3>
      <div aria-hidden="true" className="bg-paper rounded-[18px] p-1 text-[12px] max-sm:hidden">
        <div className="bg-oat text-ink-soft grid grid-cols-[1.4fr_1fr_0.6fr] gap-2 rounded-[14px] px-3 py-1.5 font-semibold">
          <span>Name</span>
          <span>Team</span>
          <span className="text-right">Visits</span>
        </div>
        {ROSTER.map((row) => (
          <div
            key={row.name}
            className="border-ink/6 grid grid-cols-[1.4fr_1fr_0.6fr] items-center gap-2 border-b px-3 py-2 last:border-b-0"
          >
            <span className="font-semibold">{row.name}</span>
            <span
              className={cn("justify-self-start rounded-full px-2 py-0.5 font-semibold", row.tone)}
            >
              {row.team}
            </span>
            <span className="text-right font-semibold tabular-nums">{row.visits}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {DATA_SOURCES.map((source) => (
          <span
            key={source}
            className="bg-paper rounded-full px-3 py-[7px] text-[13px] font-semibold whitespace-nowrap"
          >
            {source}
          </span>
        ))}
      </div>
      <p className="text-ink-muted text-[15px] leading-[1.55]">
        Connect a source once and every member sees the same live list, with reports that build
        themselves.
      </p>
    </div>
  );
}

/** The club's theme, and what each member pins for themselves. */
function CustomizationTile() {
  return (
    <div className={cn(PAPER_TILE, SPLIT_TILE, SLIDE, "flex-[2_1_520px]")}>
      <div className="flex flex-col gap-3.5">
        <TileTitle>Customization</TileTitle>
        <h3 className="font-heading text-[clamp(30px,3.2vw,44px)] leading-[1.05] tracking-[-0.025em] text-balance">
          Make it look like your club.
        </h3>
        <p className="text-ink-muted text-[16px] leading-[1.55] text-pretty">
          The club sets its colors, theme and pinned spaces for everyone. Each member then
          rearranges their own board, pins and views, so every person sees what&apos;s useful to
          them.
        </p>
      </div>
      <div className="flex flex-col gap-3.5">
        <div className="bg-cream flex flex-col gap-2 rounded-[18px] p-4">
          <span className="text-ink-soft text-[12px] font-bold">Club theme</span>
          <div className="grid grid-cols-4 gap-2">
            {THEME_PRESETS.map((preset, i) => (
              <span
                key={preset.name}
                className={cn(
                  "bg-paper flex flex-col gap-1.5 rounded-[12px] p-1.5",
                  i === 0 && "shadow-ring-ink",
                )}
              >
                <span className={cn("relative h-9 overflow-hidden rounded-[8px]", preset.tone)}>
                  {"glow" in preset && (
                    <span className="bg-glow-banana absolute -top-3 -right-3 size-9 rounded-full" />
                  )}
                  <span className="bg-paper/90 absolute bottom-1.5 left-1.5 h-1.5 w-6 rounded-full" />
                </span>
                <span className="truncate text-[11px] font-semibold">{preset.name}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="bg-cream flex flex-col gap-2 rounded-[18px] p-4 max-sm:hidden">
          <span className="text-ink-soft text-[12px] font-bold">Pinned for you</span>
          <div className="flex flex-wrap gap-1.5">
            {PINNED.map((pin) => (
              <span
                key={pin}
                className="bg-paper rounded-full px-[11px] py-1.5 text-[13px] font-semibold whitespace-nowrap"
              >
                {pin}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** People, with a mini org chart: the president over two teams. */
function PeopleTile() {
  return (
    <div
      className={cn(
        SLIDE,
        "bg-butter flex flex-[1_1_260px] flex-col gap-3 rounded-[28px] p-6 sm:min-h-80 sm:p-8",
      )}
    >
      <TileTitle tone="butter">People</TileTitle>
      <span className="bg-paper/70 text-ink-soft mt-2 flex items-center gap-2 rounded-full px-3 py-2 text-[12px]">
        <Search className="size-3.5" aria-hidden="true" />
        Search 120 members
      </span>
      <div className="mt-3 flex flex-col items-center">
        <span className="bg-ink text-cream flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[13px] font-bold">
          <span className="bg-banana text-ink grid size-6 place-items-center rounded-full text-[11px]">
            M
          </span>
          President
        </span>
        <span className="bg-ink/30 h-3.5 w-px" />
        {/* One column per team. Each draws half the crossbar, from its own
            centre toward the middle, so the bar always ends exactly over
            each team's line, however wide the names are. */}
        <div className="grid w-full max-w-[240px] grid-cols-2">
          {TEAMS.map(({ team, initial }, i) => (
            <span key={team} className="relative flex flex-col items-center pt-3">
              <span
                className={cn(
                  "bg-ink/30 absolute top-0 h-px",
                  i === 0 ? "right-0 left-1/2" : "right-1/2 left-0",
                )}
              />
              <span className="bg-ink/30 absolute top-0 left-1/2 h-3 w-px" />
              <span className="bg-paper flex items-center gap-1.5 rounded-full py-[3px] pr-2.5 pl-[3px] text-[12px] font-semibold whitespace-nowrap">
                <span className="bg-wheat grid size-5 place-items-center rounded-full text-[10px] font-bold">
                  {initial}
                </span>
                {team}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="font-heading mt-auto text-[clamp(34px,3.4vw,46px)] leading-[1.02] tracking-[-0.03em]">
        Hand over in one click.
      </div>
      <p className="text-bark-soft text-[15px] leading-[1.55] text-pretty">
        A searchable member directory and an org chart you type like an outline, saved in versions
        so next year’s board starts with everything.
      </p>
    </div>
  );
}
