import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChartGantt,
  CircleDot,
  Columns3,
  Database,
  Gauge,
  Hash,
  type IconComponent,
  LayoutDashboard,
  ListTree,
  Palette,
  Sparkles,
  Table2,
  Type,
  User,
  Users,
  Wallet,
} from "@/components/icons";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { ProductArt } from "./feature-art";
import { PRODUCT_PAGES } from "./product-pages";
import { CONTAINER, SectionIntro } from "./section-title";

/**
 * One main feature, Notion-style: a grey card with its label, a bold claim,
 * one line and the round arrow, over its illustration. The whole card links
 * to the feature's page (/product/<slug>). On phones it's one slide.
 */
function HighlightCard({ page }: { page: (typeof PRODUCT_PAGES)[number] }) {
  return (
    <li className="max-md:w-[86%] max-md:flex-none max-md:snap-start">
      <Link
        href={`/product/${page.slug}`}
        className="group bg-muted/70 hover:bg-muted rounded-card flex h-full flex-col gap-5 p-5 transition-colors sm:p-6"
        data-cta={`feature_${page.slug}`}
        data-cta-location="features"
      >
        <div className="flex flex-col gap-1.5 px-1 pt-1">
          <span className="text-foreground/60 text-[13px] font-semibold">{page.label}</span>
          <span className="flex items-start justify-between gap-4">
            <h3 className="text-[21px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance sm:text-[23px]">
              {page.cardTitle}
            </h3>
            <span
              aria-hidden="true"
              className="bg-foreground text-background grid size-7 flex-none place-items-center rounded-full transition-transform group-hover:translate-x-0.5"
            >
              <ArrowRight className="size-3.5" strokeWidth={2.5} />
            </span>
          </span>
          <p className="text-foreground/75 text-[15px] leading-[1.5] text-pretty">
            {page.cardBody}
          </p>
        </div>
        <div aria-hidden="true" className="mt-auto">
          <ProductArt slug={page.slug} />
        </div>
      </Link>
    </li>
  );
}

/** The six task views, by name. */
const TASK_VIEWS: readonly { name: string; icon: IconComponent }[] = [
  { name: "Board", icon: Columns3 },
  { name: "List", icon: ListTree },
  { name: "Table", icon: Table2 },
  { name: "Week", icon: CalendarClock },
  { name: "Roadmap", icon: ChartGantt },
  { name: "Dashboard", icon: Gauge },
];

/** A card's small picture: a soft panel under its text. */
const PICTURE = "bg-muted/70 rounded-[14px] p-3.5";

/** A card on the grid: a symbol, a claim, a line, and a small picture of it. */
function Card({
  icon: Icon,
  title,
  body,
  wide = false,
  children,
}: {
  icon: IconComponent;
  title: string;
  body: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "border-border flex flex-col gap-4 rounded-[20px] border p-5",
        wide && "sm:col-span-2",
      )}
    >
      <span className="flex items-start gap-3">
        <span className="bg-muted grid size-9 flex-none place-items-center rounded-full">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">{title}</span>
          <span className="text-foreground/75 text-[14px] leading-[1.5]">{body}</span>
        </span>
      </span>
      <div aria-hidden="true" className="mt-auto">
        {children}
      </div>
    </li>
  );
}

function ProjectsPicture() {
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 min-[440px]:grid-cols-3">
        {TASK_VIEWS.map(({ name, icon: Icon }) => (
          <li
            key={name}
            className="bg-muted/70 flex min-w-0 items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] font-semibold whitespace-nowrap"
          >
            <Icon className="size-4 flex-none" />
            {name}
          </li>
        ))}
      </ul>
      <span className={cn(PICTURE, "flex flex-col gap-2 py-3")}>
        <span className="flex justify-between text-[12px]">
          <span className="font-semibold">Fall launch</span>
          <span className="text-muted-foreground tabular-nums">18 of 24 done</span>
        </span>
        <span className="bg-foreground/10 block h-1.5 overflow-hidden rounded-full">
          <span className="bg-foreground block h-full w-3/4 rounded-full" />
        </span>
      </span>
    </div>
  );
}

/** Six months of spend, as bars (percent of the tallest). */
const SPEND = [38, 52, 44, 70, 58, 86] as const;

function FinancePicture() {
  return (
    <div className={cn(PICTURE, "grid grid-cols-[auto_1fr] items-end gap-5")}>
      <span className="flex flex-col gap-2">
        <span className="flex flex-col">
          <span className="text-muted-foreground text-[11px] font-semibold">Runway</span>
          <span className="numeral text-[22px] leading-tight">14 mo</span>
        </span>
        <span className="flex flex-col">
          <span className="text-muted-foreground text-[11px] font-semibold">Left this quarter</span>
          <span className="numeral text-[22px] leading-tight">$12,400</span>
        </span>
      </span>
      <span className="flex h-[84px] items-end gap-1.5">
        {SPEND.map((height, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-t-[5px]",
              i === SPEND.length - 1 ? "bg-banana" : "bg-foreground/20",
            )}
            style={{ height: `${height}%` }}
          />
        ))}
      </span>
    </div>
  );
}

/** Who's free, by slot (0 to 3 people); the best slot is marked. */
const FREE = [1, 2, 3, 2, 0, 2, 3, 3, 1, 2, 0, 1, 2, 3, 1] as const;
const BEST = 7;
const SHADE = ["bg-foreground/5", "bg-foreground/15", "bg-foreground/25", "bg-foreground/40"];

function FindTimePicture() {
  return (
    <span className={cn(PICTURE, "grid grid-cols-5 gap-1")}>
      {FREE.map((n, i) => (
        <span key={i} className={cn("h-4 rounded-[4px]", i === BEST ? "bg-banana" : SHADE[n])} />
      ))}
    </span>
  );
}

const WEEK = ["M", "T", "W", "T", "F", "S", "S"] as const;
/** Which days of the week have something on, and in what tone. */
const ON: Partial<Record<number, string>> = {
  1: "bg-(--tag-navy)",
  3: "bg-banana",
  4: "bg-(--tag-forest)",
};

function CalendarPicture() {
  return (
    <span className={cn(PICTURE, "grid grid-cols-7 gap-1 text-center")}>
      {WEEK.map((day, i) => (
        <span key={i} className="flex flex-col items-center gap-1.5">
          <span className="text-muted-foreground text-[10px] font-semibold">{day}</span>
          <span className="numeral text-[13px]">{27 + i > 31 ? 27 + i - 31 : 27 + i}</span>
          <span className={cn("h-1 w-4 rounded-full", ON[i] ?? "bg-transparent")} />
        </span>
      ))}
    </span>
  );
}

const SWATCHES = [
  "bg-banana",
  "bg-(--tag-navy)",
  "bg-(--tag-plum)",
  "bg-(--tag-forest)",
  "bg-(--tag-rust)",
  "bg-(--tag-teal)",
] as const;

function CustomizePicture() {
  return (
    <span className={cn(PICTURE, "flex flex-col gap-2.5")}>
      <span className="flex gap-1.5">
        {SWATCHES.map((tone, i) => (
          <span
            key={tone}
            className={cn(
              "size-5 rounded-full",
              tone,
              i === 0 && "ring-foreground ring-offset-muted ring-2 ring-offset-2",
            )}
          />
        ))}
      </span>
      <span className="flex gap-1.5">
        {["Runway", "Up next"].map((name) => (
          <span
            key={name}
            className="bg-card flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11px] font-semibold shadow-[var(--elevation-1)]"
          >
            <LayoutDashboard className="size-3.5" />
            {name}
          </span>
        ))}
      </span>
    </span>
  );
}

const PEOPLE = [
  { initials: "MC", tone: "bg-(--tag-ochre)/12 text-(--tag-ochre)" },
  { initials: "JP", tone: "bg-(--tag-teal)/12 text-(--tag-teal)" },
  { initials: "SO", tone: "bg-(--tag-rust)/12 text-(--tag-rust)" },
  { initials: "AK", tone: "bg-(--tag-plum)/12 text-(--tag-plum)" },
] as const;

function PeoplePicture() {
  return (
    <span className={cn(PICTURE, "flex items-center justify-between gap-2")}>
      <span className="flex">
        {PEOPLE.map(({ initials, tone }) => (
          <span
            key={initials}
            className={cn(
              "ring-muted -ml-2 grid size-8 place-items-center rounded-full text-[11px] font-bold ring-2 first:ml-0",
              tone,
            )}
          >
            {initials}
          </span>
        ))}
      </span>
      <span className="flex flex-col items-end text-[11px] leading-tight">
        <span className="font-semibold">Design team</span>
        <span className="text-muted-foreground">Lead · Maya Chen</span>
      </span>
    </span>
  );
}

/** Members by month, as the chart AI drew (percent of the tallest). */
const MEMBERS = [30, 42, 48, 61, 74, 92] as const;

function AnalysisPicture() {
  return (
    <div className={cn(PICTURE, "flex flex-col gap-2.5")}>
      <span className="flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-3.5" /> Members by month
        </span>
        <span className="text-muted-foreground">Made from Members</span>
      </span>
      <span className="flex h-[64px] items-end gap-1.5">
        {MEMBERS.map((height, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-[5px] bg-(--tag-navy)/70"
            style={{ height: `${height}%` }}
          />
        ))}
      </span>
      <span className="text-[11.5px] leading-[1.4]">
        <b>Up 3x since May.</b> Most new members joined after the spring showcase.
      </span>
    </div>
  );
}

/** The databases picture's columns: a field name and its type's symbol. */
const FIELDS: readonly { name: string; icon: IconComponent }[] = [
  { name: "Sponsor", icon: Type },
  { name: "Stage", icon: CircleDot },
  { name: "Owner", icon: User },
  { name: "Amount", icon: Hash },
];

const DEALS = [
  {
    sponsor: "Northwind",
    stage: "Signed",
    tone: "bg-(--tag-forest)/12",
    owner: "Maya",
    amount: "$5,000",
  },
  {
    sponsor: "Acme Co.",
    stage: "Pitched",
    tone: "bg-(--tag-navy)/12",
    owner: "Jay",
    amount: "$2,500",
  },
] as const;

function DatabasePicture() {
  return (
    <div className={cn(PICTURE, "flex flex-col gap-1 text-[11.5px]")}>
      <span className="grid grid-cols-4 gap-2 pb-1">
        {FIELDS.map(({ name, icon: Icon }) => (
          <span key={name} className="text-muted-foreground flex items-center gap-1 font-semibold">
            <Icon className="size-3.5" />
            {name}
          </span>
        ))}
      </span>
      {DEALS.map((deal) => (
        <span
          key={deal.sponsor}
          className="bg-card grid grid-cols-4 items-center gap-2 rounded-[8px] px-2 py-1.5"
        >
          <span className="font-semibold">{deal.sponsor}</span>
          <span
            className={cn(
              "justify-self-start rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
              deal.tone,
            )}
          >
            {deal.stage}
          </span>
          <span>{deal.owner}</span>
          <span className="tabular-nums">{deal.amount}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Everything else, on a four-column grid: projects and finance wide on top,
 * four smaller things with a picture each, then AI analysis and the
 * databases wide.
 */
function Essentials() {
  return (
    <div className="flex flex-col gap-8">
      <h3 className="display-title text-center text-[clamp(28px,3vw,40px)] leading-[1.1] tracking-[-0.03em]">
        Plus everything else your team needs.
      </h3>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          wide
          icon={Columns3}
          title="Projects and tasks, six ways"
          body="Epics, stories and tasks with owners, due dates and reminders."
        >
          <ProjectsPicture />
        </Card>
        <Card
          wide
          icon={Wallet}
          title="Finance and reports"
          body="Budgets, receipts, payback approvals and sponsors, with live reports on spend and runway."
        >
          <FinancePicture />
        </Card>
        <Card
          icon={CalendarClock}
          title="Find a time"
          body="One poll link shows when everyone's free. Book it in a click."
        >
          <FindTimePicture />
        </Card>
        <Card
          icon={CalendarDays}
          title="Calendar"
          body="Month, week and day views, with a personal feed for everyone."
        >
          <CalendarPicture />
        </Card>
        <Card
          icon={Palette}
          title="Make it yours"
          body="Your colors and logo, and the widgets you want on Overview and Finance."
        >
          <CustomizePicture />
        </Card>
        <Card
          icon={Users}
          title="People"
          body="Everyone's profile, role and team in one directory, with an org chart."
        >
          <PeoplePicture />
        </Card>
        <Card
          wide
          icon={ChartColumn}
          title="AI analysis on your data"
          body="Bananasplit's AI turns any database into charts and a plain-language summary, on its own."
        >
          <AnalysisPicture />
        </Card>
        <Card
          wide
          icon={Database}
          title="Built-in databases"
          body="Spreadsheets and databases with typed fields: text, numbers, dates, people, files and statuses. Filter, sort and group any way, link records, and sync with Supabase if you use it."
        >
          <DatabasePicture />
        </Card>
      </ul>
    </div>
  );
}

/**
 * "Everything your team runs, in one place.": the four main features as a
 * 2×2 of cards that open their pages (one swipeable row on phones), then
 * everything else in a quieter grid.
 */
export function Features() {
  return (
    <section
      id="features"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-12 pt-28 sm:gap-14 sm:pt-36")}
    >
      <SectionIntro title="Everything your team runs, in one place.">
        Stop paying for six tools that don&apos;t talk to each other.
      </SectionIntro>
      <ul className="m-0 grid list-none gap-4 p-0 max-md:-mx-6 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:scroll-px-6 max-md:[scrollbar-width:none] max-md:overflow-x-auto max-md:px-6 max-md:pb-2 md:grid-cols-2">
        {PRODUCT_PAGES.map((page) => (
          <HighlightCard key={page.slug} page={page} />
        ))}
      </ul>
      <Essentials />
    </section>
  );
}
