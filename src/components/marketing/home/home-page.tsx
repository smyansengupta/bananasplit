import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowRight } from "@/components/brand/arrows";
import {
  ArrowUpRight,
  Columns3,
  Vote,
  Ticket,
  Database,
  CalendarDays,
  Download,
  FileSpreadsheet,
  FileText,
  Folder,
  KeyRound,
  Lock,
  MessageCircle,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
  type IconComponent,
} from "@/components/icons";
import { cn } from "@/lib/utils";

import { BrandMark } from "../brand-mark";
import { BRANDS, brandBySlug, type BrandGroup } from "../brands";
import { DEMO_HREF, PRIMARY_CTA, SECONDARY_CTA, startHref } from "../links";
import { CLAUDE_CHAT } from "../palette";
import { SiteLink } from "../site-link";
import { HeroStage } from "./hero-stage";
import { IPhone, ReplyCard, Thread, type Message } from "./iphone";

/**
 * The home page (/): light, centred, few words, in
 * Bananasplit's own look (Geist headlines, the banana button, the Young
 * Serif wordmark), leading with the category, "The First Ambient Workplace": the
 * team's work keeps itself up to date, listening where people already work,
 * handling the busywork, and texting only when something needs a decision
 * (docs/AMBIENT-WORKPLACE.md). Each section says one part of that: it comes
 * to you, it listens, it keeps itself current, it acts only where you let it. In order: the hero (the real
 * dashboard, public/marketing/dashboard-light.png from /dev/dashboard, and
 * an iPhone texting it: the pieces rise in and the thread fills, brand.css's
 * home-* animations; then, on scroll, the dashboard eases up to full size
 * and the phone rises over it, HeroStage); every app it works with; running
 * it by text; the integrations (your AI and notes, then a row of four: a
 * call, your database, your inbox, analysis of your data); the main features
 * (docs, files, finance, AI, meetings and Find a time); the basics; security;
 * and "Running your organization shouldn't be bananas."
 */

const CONTAINER = "mx-auto w-full max-w-[1200px] px-5 sm:px-6";

/** Every panel on the page: a white card with a hairline and the app's soft lift. */
function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "bg-card border-foreground/[0.08] relative overflow-hidden rounded-[24px] border shadow-(--elevation-1)",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The pictures' inner surface, inside a panel. */
const INSET = "bg-muted/60 rounded-[16px]";

/** A section's opening, centred: the display title and one short line. */
function SectionIntro({ title, line }: { title: ReactNode; line?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-center gap-4 text-center">
      <h2 className="display-title m-0 text-[clamp(34px,4.4vw,56px)] leading-[1.04] tracking-[-0.04em] text-balance">
        {title}
      </h2>
      {line && (
        <p className="text-foreground/70 m-0 max-w-[520px] text-[17px] leading-[1.55] text-pretty">
          {line}
        </p>
      )}
    </div>
  );
}

/** A feature tile: a claim, a line, ↗ when it opens a page, then its picture. */
function Tile({
  title,
  body,
  href,
  className,
  children,
}: {
  title: string;
  body: string;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const inner = (
    <>
      <span className="flex items-start justify-between gap-4">
        <span className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[20px] leading-[1.25] font-semibold tracking-[-0.015em]">
            {title}
          </h3>
          <span className="text-foreground/70 text-[15px] leading-[1.5] text-pretty">{body}</span>
        </span>
        {href && (
          <span
            aria-hidden="true"
            className="border-foreground/15 grid size-8 flex-none place-items-center rounded-full border transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          >
            <ArrowUpRight className="size-4" />
          </span>
        )}
      </span>
      <div aria-hidden="true" className="mt-auto">
        {children}
      </div>
    </>
  );
  return (
    <li className={className}>
      <Panel className="h-full">
        {href ? (
          <Link
            href={href}
            className="group hover:bg-muted/30 flex h-full flex-col gap-6 p-6 transition-colors"
          >
            {inner}
          </Link>
        ) : (
          <div className="flex h-full flex-col gap-6 p-6">{inner}</div>
        )}
      </Panel>
    </li>
  );
}

// ================================================================== hero

const HERO_THREAD: readonly Message[] = [
  {
    from: "bananasplit",
    text: "Morning, Maya. Design review at 2, and the Acme proposal is due Friday.",
  },
  { from: "you", text: "Move tomorrow's standup to 10 and tell the team" },
  {
    from: "bananasplit",
    text: "Done. 6 people notified.",
    card: <ReplyCard icon="calendar" title="Standup" meta="Wed · 10:00 AM" />,
  },
  { from: "bananasplit", text: "Jay sent an $86 receipt for the venue. Approve?" },
  { from: "you", text: "Yes" },
  { from: "bananasplit", text: "Approved. He'll be paid back Friday." },
];

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    // A neutral wash from white down to the apps strip's grey, so the product sits on something.
    <section className="to-muted/70 relative isolate bg-linear-to-b from-transparent from-40%">
      <div className={cn(CONTAINER, "flex flex-col items-center pt-[clamp(36px,5vw,72px)]")}>
        <div className="flex max-w-[920px] flex-col items-center gap-6 text-center">
          {/* The category, named. On phones the size follows the screen width, so "Ambient Workplace." fits one line. */}
          <h1 className="display-title animate-home-rise m-0 text-[9.4vw] leading-[0.95] tracking-[-0.05em] whitespace-nowrap sm:text-[clamp(48px,7.2vw,96px)]">
            The First{" "}
            <br />
            Ambient Workplace.
          </h1>
          <p
            className="text-foreground/75 animate-home-rise m-0 max-w-[600px] text-[clamp(17px,1.6vw,20px)] leading-[1.5] text-pretty"
            style={{ animationDelay: "0.12s" }}
          >
            Your team&apos;s work keeps itself up to date. It listens where you already work,
            handles the busywork, and texts you only when something needs you.
          </p>
          <div
            className="animate-home-rise flex flex-wrap items-center justify-center gap-3 pt-1"
            style={{ animationDelay: "0.24s" }}
          >
            <Link
              href={startHref(signedIn)}
              className={PRIMARY_CTA}
              data-cta="get_started"
              data-cta-location="hero"
            >
              Get started free <ArrowRight />
            </Link>
            <SiteLink
              href={DEMO_HREF}
              className={SECONDARY_CTA}
              data-cta="request_demo"
              data-cta-location="hero"
            >
              Request a demo
            </SiteLink>
          </div>
        </div>

        {/*
          The dashboard and the phone, both cut off at the bottom of a fixed
          frame that fades out. The dashboard rises in and the phone's thread
          fills; as the page scrolls (HeroStage's --p), the dashboard eases up to
          full size and the phone rises. The entrance sits on the inner element,
          the scroll on the outer ones, so the two never fight.
        */}
        <HeroStage className="relative mt-[clamp(32px,4vw,56px)] h-[440px] w-full max-w-[1100px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)] sm:aspect-[1100/560] sm:h-auto">
          <div className="absolute inset-x-0 top-0 origin-top [transform:translateY(calc((1-var(--p))*36px))_scale(calc(0.9+var(--p)*0.1))] will-change-transform">
            <div
              className="animate-home-stage bg-card border-foreground/10 rounded-[22px] border p-1.5"
              style={{ animationDelay: "0.35s" }}
            >
              <div className="relative aspect-square overflow-hidden rounded-[16px] sm:aspect-[1440/860]">
                <Image
                  src="/marketing/dashboard-light.png"
                  alt="The Bananasplit dashboard: tasks due this week, what's up next, my tasks and the week ahead, with work added by text"
                  fill
                  priority
                  sizes="(min-width: 1200px) 1088px, (min-width: 640px) 95vw, 170vw"
                  className="object-cover object-left-top"
                />
              </div>
            </div>
          </div>
          <div className="absolute top-[150px] left-1/2 z-10 w-[220px] -translate-x-1/2 [transform:translateY(calc((1-var(--p))*120px))] will-change-transform sm:top-[18%] sm:right-[4%] sm:left-auto sm:w-[clamp(210px,24vw,280px)] sm:translate-x-0">
            <IPhone messages={HERO_THREAD} arriveAt={1.2} fromTop />
          </div>
        </HeroStage>
      </div>
    </section>
  );
}

// ======================================================== the apps

/** A full-width light grey band with a small heading (the apps). */
function Strip({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("bg-muted/70 w-full py-8 sm:py-10", className)}>
      <div className={cn(CONTAINER, "flex flex-col items-center gap-6")}>
        <h2 id={id} className="text-foreground/60 m-0 text-[15px] font-medium">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function WorksWith() {
  return (
    <Strip id="home-works-with" title="Works with the apps you already use">
      <ul className="m-0 flex max-w-[1080px] list-none flex-wrap items-center justify-center gap-x-8 gap-y-5 p-0 max-sm:gap-x-5">
        {BRANDS.map((brand) => (
          <li key={brand.slug} className="flex items-center gap-2.5">
            <BrandMark brand={brand} size={30} />
            {/* Phones: the logos alone (the names stay for screen readers). */}
            <span className="text-[15px] font-semibold tracking-[-0.01em] max-sm:sr-only">
              {brand.name}
            </span>
          </li>
        ))}
      </ul>
    </Strip>
  );
}

// ========================================================== on the go

const TEXTS: readonly Message[] = [
  { from: "bananasplit", text: "The Acme proposal hasn't moved in 5 days. It's due Friday." },
  { from: "you", text: "Remind Maya and give her till Monday" },
  {
    from: "bananasplit",
    text: "Done. Maya has it.",
    card: <ReplyCard icon="task" title="Send the Acme proposal" meta="Maya · due Mon" />,
  },
  { from: "you", text: "What's on today?" },
  { from: "bananasplit", text: "Design review at 2. Nothing else needs you." },
];

const STEPS: readonly { icon: IconComponent; title: string; body: string }[] = [
  { icon: MessageCircle, title: "It listens", body: "Texts, email, meetings and AI chats." },
  { icon: Sparkles, title: "It handles it", body: "Files, books, updates and follows up." },
  {
    icon: RefreshCw,
    title: "It asks only when it matters",
    body: "A decision by text. Reply yes.",
  },
];

function OnTheGo() {
  return (
    <section
      id="texting"
      aria-labelledby="home-on-the-go"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-8 pt-16 sm:pt-24")}
    >
      <div id="home-on-the-go">
        <SectionIntro
          title="It comes to you."
          line="A brief each morning, a nudge when something slips, and anything else by text."
        />
      </div>
      <Link
        href="/product/texting"
        className="group block rounded-[24px]"
        data-cta="feature_texting"
        data-cta-location="on_the_go"
      >
        <Panel className="grid gap-8 p-5 transition-shadow group-hover:shadow-(--elevation-2) sm:p-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12 lg:p-10">
          <div aria-hidden="true" className="flex flex-col justify-center">
            <Thread messages={TEXTS} />
          </div>
          <ol className="lg:border-border m-0 flex list-none flex-col justify-center gap-6 p-0 lg:border-l lg:pl-12">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex items-center gap-4">
                <span className="bg-muted relative grid size-11 flex-none place-items-center rounded-full">
                  <Icon className="size-5" aria-hidden="true" />
                  <span className="bg-banana text-ink absolute -top-1 -right-1 grid size-5 place-items-center rounded-full text-[11px] font-bold">
                    {i + 1}
                  </span>
                </span>
                <span className="flex flex-col">
                  <h3 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
                  <p className="text-foreground/70 m-0 text-[15px]">{body}</p>
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-1 text-[15px] font-semibold">
              See how it works
              <span
                aria-hidden="true"
                className="border-foreground/15 grid size-8 place-items-center rounded-full border transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              >
                <ArrowUpRight className="size-4" />
              </span>
            </li>
          </ol>
        </Panel>
      </Link>
    </section>
  );
}

// ======================================================= integrations

/** Claude, told to add its plan to Bananasplit, in its own colours. */
function ClaudePicture() {
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[16px] p-4 text-[13px] leading-[1.4]"
      style={{ backgroundColor: CLAUDE_CHAT.surface, color: CLAUDE_CHAT.ink }}
    >
      <span
        className="self-end rounded-[12px] px-3 py-2"
        style={{ backgroundColor: CLAUDE_CHAT.bubble }}
      >
        Turn the launch plan into tasks and add them to Bananasplit.
      </span>
      <span className="flex flex-col gap-1.5">
        <span>Done. I added 3 tasks to Fall launch:</span>
        {[
          "Finalize the sponsor deck · Jay",
          "Book the venue · Maya",
          "Send the press kit · Sam",
        ].map((t) => (
          <span key={t} className="flex items-center gap-2">
            <span
              className="size-3.5 flex-none rounded-full"
              style={{ backgroundColor: CLAUDE_CHAT.accent }}
            />
            {t}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The row under the AI panel: the other connections, as the home page states them. */
const CARDS: readonly {
  key: string;
  group: Exclude<BrandGroup, "ai">;
  title: string;
  body: string;
}[] = [
  {
    key: "meetings",
    group: "meetings",
    title: "Book a call",
    body: "Zoom, Teams or Meet, from any event.",
  },
  { key: "data", group: "data", title: "Your database", body: "Supabase tables, kept in sync." },
  {
    key: "inbox",
    group: "inbox",
    title: "Your inbox",
    body: "Email, invites and assignments, as tasks.",
  },
  {
    key: "notes",
    group: "notes",
    title: "Notes that file themselves",
    body: "Granola notes and Wispr Flow dictation, in your docs.",
  },
];

function Marks({ group }: { group: BrandGroup }) {
  return (
    <span className="flex">
      {BRANDS.filter((b) => b.group === group).map((b) => (
        <span key={b.slug} className="ring-card -ml-1.5 rounded-[8px] ring-2 first:ml-0">
          <BrandMark brand={b} size={26} />
        </span>
      ))}
    </span>
  );
}

function Integrations() {
  return (
    <section
      id="integrations"
      aria-labelledby="home-integrations"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-8 pt-16 sm:pt-24")}
    >
      <div id="home-integrations">
        <SectionIntro
          title="It listens where you already work."
          line="What your tools make lands in Bananasplit, on its own."
        />
      </div>
      <Panel className="grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
        <div className="flex flex-col gap-3">
          <Marks group="ai" />
          <h3 className="display-title m-0 text-[clamp(24px,2.4vw,32px)] leading-[1.1] tracking-[-0.03em]">
            Ask your AI. It&apos;s in Bananasplit.
          </h3>
          <p className="text-foreground/70 m-0 max-w-[420px] text-[15px] leading-[1.55]">
            Tell Claude or ChatGPT to add it. The tasks, events and docs appear.
          </p>
        </div>
        <div aria-hidden="true">
          <ClaudePicture />
        </div>
      </Panel>
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map(({ key, group, title, body }) => (
          <li key={key}>
            <Panel className="flex h-full flex-col gap-4 p-5">
              <Marks group={group} />
              <span className="flex flex-col gap-1">
                <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">{title}</h3>
                <span className="text-foreground/70 text-[14px] leading-[1.45]">{body}</span>
              </span>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ======================================================== the main ones

/** A doc edited together: two cursors, a comment, a line turned into a task. */
function DocPicture() {
  return (
    <div className={cn(INSET, "grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_200px]")}>
      <div className="bg-card flex flex-col gap-2.5 rounded-[12px] p-4 shadow-(--elevation-1)">
        <span className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">Fall launch plan</span>
          <span className="flex">
            {[
              ["MC", "var(--tag-navy)"],
              ["JP", "var(--tag-forest)"],
              ["SO", "var(--tag-plum)"],
            ].map(([who, tone], i) => (
              <span
                key={who}
                className={cn(
                  "ring-card grid size-6 place-items-center rounded-full text-[9px] font-bold text-white ring-2",
                  i > 0 && "-ml-1.5",
                )}
                style={{ backgroundColor: tone }}
              >
                {who}
              </span>
            ))}
          </span>
        </span>
        <span className="text-muted-foreground text-[11px] font-semibold">Goals</span>
        <span className="flex items-center gap-1">
          <span className="bg-foreground/10 h-1.5 w-[58%] rounded-full" />
          <span className="h-4 w-[2px] rounded-full bg-(--tag-forest)" />
          <span className="rounded-[4px] bg-(--tag-forest) px-1 text-[9px] font-bold text-white">
            Jay
          </span>
        </span>
        <span className="bg-foreground/10 h-1.5 w-[84%] rounded-full" />
        <span className="flex flex-wrap items-center gap-2">
          <span className="decoration-banana text-[12.5px] underline decoration-2 underline-offset-4">
            Send the press kit to Acme
          </span>
          <span className="bg-banana text-ink rounded-full px-2 py-0.5 text-[10px] font-bold">
            Task · Sam · Fri
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="bg-foreground/10 h-1.5 w-[46%] rounded-full" />
          <span className="h-4 w-[2px] rounded-full bg-(--tag-plum)" />
        </span>
      </div>
      <div className="bg-card flex flex-col gap-2 self-start rounded-[12px] p-3 shadow-(--elevation-1)">
        <span className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-(--tag-navy) text-[9px] font-bold text-white">
            MC
          </span>
          <span className="text-[12px] font-semibold">Maya</span>
        </span>
        <span className="text-foreground/80 text-[12px] leading-[1.4]">
          Move the launch to the 14th? @Jay
        </span>
      </div>
    </div>
  );
}

function FilesPicture() {
  const files: readonly { icon: IconComponent; name: string; meta: string }[] = [
    { icon: FileText, name: "Sponsor deck.pdf", meta: "2.4 MB" },
    { icon: FileSpreadsheet, name: "Budget FY27.xlsx", meta: "96 KB" },
  ];
  return (
    <div className={cn(INSET, "flex flex-col gap-2 p-3.5")}>
      <span className="flex items-center gap-2 px-1 text-[12px] font-semibold">
        <Folder className="size-4" />
        Brand kit
      </span>
      {files.map(({ icon: Icon, name, meta }) => (
        <span
          key={name}
          className="bg-card flex items-center gap-2.5 rounded-[10px] px-3 py-2 shadow-(--elevation-1)"
        >
          <Icon className="size-4 flex-none" />
          <span className="flex-1 truncate text-[12px] font-medium">{name}</span>
          <span className="text-muted-foreground text-[11px] tabular-nums">{meta}</span>
        </span>
      ))}
      <span className="flex flex-col gap-1.5 px-1 pt-1">
        <span className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
          <span className="bg-banana block h-full w-[12%] rounded-full" />
        </span>
        <span className="text-muted-foreground text-[11px]">12 GB of 100 GB</span>
      </span>
    </div>
  );
}

function AiPicture() {
  const asks = ["Draft the board update", "Plan the launch", "Write the agenda"];
  return (
    <div className={cn(INSET, "flex flex-col gap-3 p-3.5")}>
      <span className="bg-card flex items-center gap-2 rounded-full px-3 py-2 text-[12.5px] shadow-(--elevation-1)">
        <Sparkles className="size-4" />
        <span className="text-muted-foreground flex-1">Ask Bananasplit anything…</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {asks.map((a) => (
          <span key={a} className="bg-card rounded-full px-2.5 py-1 text-[11.5px] font-medium">
            {a}
          </span>
        ))}
      </span>
      <span className="bg-card flex flex-col gap-1.5 rounded-[12px] p-3">
        <span className="bg-foreground/10 h-1.5 w-[92%] rounded-full" />
        <span className="bg-foreground/10 h-1.5 w-[74%] rounded-full" />
        <span className="text-muted-foreground text-[10.5px]">From 12 tasks and 3 notes</span>
      </span>
    </div>
  );
}

/** The budget by category, runway, and a payback waiting on approval. */
function FinancePicture() {
  const categories = [
    { name: "Events", spent: 2900, budget: 4000 },
    { name: "Marketing", spent: 1700, budget: 2000 },
    { name: "Food", spent: 1150, budget: 1000 },
  ];
  const months = [38, 52, 44, 70, 58, 86];
  return (
    <div className={cn(INSET, "grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px]")}>
      <div className="bg-card flex flex-col gap-3 rounded-[12px] p-4 shadow-(--elevation-1)">
        <span className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Fall budget</span>
          <span className="text-muted-foreground text-[11px]">$5,750 of $7,000</span>
        </span>
        {categories.map((c) => {
          const pct = Math.min(100, Math.round((c.spent / c.budget) * 100));
          const over = c.spent > c.budget;
          return (
            <span key={c.name} className="flex flex-col gap-1.5">
              <span className="flex justify-between text-[12px]">
                <span className="font-medium">{c.name}</span>
                <span
                  className={cn(
                    "tabular-nums",
                    over ? "text-tint-danger-foreground font-semibold" : "text-muted-foreground",
                  )}
                >
                  ${c.spent.toLocaleString("en-US")} of ${c.budget.toLocaleString("en-US")}
                </span>
              </span>
              <span className="bg-foreground/10 h-2 overflow-hidden rounded-full">
                <span
                  className={cn("block h-full rounded-full", over ? "bg-destructive" : "bg-banana")}
                  style={{ width: `${pct}%` }}
                />
              </span>
            </span>
          );
        })}
      </div>
      <div className="flex flex-col gap-3">
        <span className="bg-card flex flex-col gap-2 rounded-[12px] p-3.5 shadow-(--elevation-1)">
          <span className="text-muted-foreground text-[11px] font-semibold">Runway</span>
          <span className="numeral text-[26px] leading-none">14 mo</span>
          <span className="flex h-10 items-end gap-1">
            {months.map((h, i) => (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-t-[3px]",
                  i === months.length - 1 ? "bg-banana" : "bg-foreground/15",
                )}
                style={{ height: `${h}%` }}
              />
            ))}
          </span>
        </span>
        <span className="bg-card flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 shadow-(--elevation-1)">
          <span className="grid size-7 flex-none place-items-center rounded-full bg-(--tag-navy) text-[10px] font-bold text-white">
            MC
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[12px] font-semibold">Receipt · $86</span>
            <span className="text-muted-foreground truncate text-[11px]">Maya · to approve</span>
          </span>
        </span>
      </div>
    </div>
  );
}

/** A meeting with its call booked, beside the poll that found the time. */
function MeetingsPicture() {
  const free = [1, 2, 3, 2, 0, 2, 3, 3, 1, 2, 0, 1, 2, 3, 1];
  const best = 7;
  const shade = ["bg-foreground/5", "bg-foreground/15", "bg-foreground/25", "bg-foreground/40"];
  return (
    <div className={cn(INSET, "grid gap-3 p-4 md:grid-cols-2")}>
      <div className="bg-card flex flex-col gap-3 rounded-[12px] p-4 shadow-(--elevation-1)">
        <span className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">Acme kickoff</span>
          <span className="text-muted-foreground text-[12px]">Thu · 2:00 PM</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {["zoom", "google-meet", "microsoft-teams"].map((slug, i) => (
            <span
              key={slug}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                i === 0 ? "bg-foreground text-background" : "bg-muted",
              )}
            >
              <BrandMark brand={brandBySlug(slug)} size={16} />
              {brandBySlug(slug).name}
            </span>
          ))}
        </span>
        <span className="text-muted-foreground text-[12px]">Call link sent with the invite.</span>
      </div>
      <div className="bg-card flex flex-col gap-2.5 rounded-[12px] p-4 shadow-(--elevation-1)">
        <span className="flex items-center justify-between text-[12px]">
          <span className="font-semibold">Find a time</span>
          <span className="text-muted-foreground">8 of 9 answered</span>
        </span>
        <span className="grid grid-cols-5 gap-1">
          {free.map((n, i) => (
            <span
              key={i}
              className={cn("h-4 rounded-[4px]", i === best ? "bg-banana" : shade[n])}
            />
          ))}
        </span>
        <span className="text-[12px]">
          <b>Thu at 2</b> works for everyone.
        </span>
      </div>
    </div>
  );
}

function MainFeatures() {
  return (
    <section
      id="product"
      aria-labelledby="home-main"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-8 pt-16 sm:pt-24")}
    >
      <div id="home-main">
        <SectionIntro
          title="Kept current, on its own."
          line="Everything your team runs, in one place that updates itself."
        />
      </div>
      <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-6">
        <Tile
          className="lg:col-span-4"
          title="Docs you edit together"
          body="Write live, comment, and turn any line into a task."
          href="/product/docs"
        >
          <DocPicture />
        </Tile>
        <Tile
          className="lg:col-span-2"
          title="Files that file themselves"
          body="Every file lands next to its work."
        >
          <FilesPicture />
        </Tile>
        <Tile
          className="lg:col-span-2"
          title="AI in every corner"
          body="It drafts the update, plans the project, writes the agenda."
          href="/product/ai"
        >
          <AiPicture />
        </Tile>
        <Tile
          className="lg:col-span-4"
          title="Finance, handled"
          body="Receipts file themselves. Budgets and runway update live."
          href="/product/finance"
        >
          <FinancePicture />
        </Tile>
        <Tile
          className="lg:col-span-6"
          title="Meetings that run themselves"
          body="A time that works, the call booked, and reminders sent for you."
          href="/product/meetings"
        >
          <MeetingsPicture />
        </Tile>
      </ul>
    </section>
  );
}

// ========================================================== the basics

const BASICS: readonly { icon: IconComponent; title: string; body: string }[] = [
  { icon: Columns3, title: "Projects and tasks", body: "Six ways to see the work." },
  { icon: CalendarDays, title: "Calendar", body: "Month, week and day, for everyone." },
  { icon: Ticket, title: "Events and RSVPs", body: "Sign-ups, waitlists, check-in." },
  { icon: Users, title: "People", body: "Profiles, teams, org chart." },
  { icon: Database, title: "Databases and analysis", body: "Charts and a summary, automatically." },
  { icon: Vote, title: "Polls and votes", body: "Quick questions, real answers." },
];

function Basics() {
  return (
    <section aria-labelledby="home-basics" className={cn(CONTAINER, "pt-10")}>
      <h2
        id="home-basics"
        className="text-foreground/60 m-0 mb-5 text-center text-[15px] font-medium"
      >
        And the basics, done well
      </h2>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {BASICS.map(({ icon: Icon, title, body }) => (
          <li key={title}>
            <Panel className="flex h-full items-center gap-3.5 p-5">
              <span className="bg-muted grid size-10 flex-none place-items-center rounded-full">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="flex flex-col">
                <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
                <span className="text-foreground/70 text-[14px]">{body}</span>
              </span>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ========================================================== security

const TRUST: readonly { icon: IconComponent; title: string; body: string }[] = [
  { icon: Lock, title: "Walled off", body: "Each organization's data, apart." },
  { icon: ShieldCheck, title: "Role-based access", body: "Everyone sees what's theirs." },
  { icon: ScrollText, title: "Full audit log", body: "Every change, who, and when." },
  { icon: KeyRound, title: "Encrypted at rest", body: "Files and records, locked." },
  { icon: Download, title: "Export anytime", body: "Take everything with you." },
];

function Security() {
  return (
    <section
      id="security"
      aria-labelledby="home-security"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-8 pt-16 sm:pt-24")}
    >
      <div id="home-security">
        <SectionIntro
          title="Secure by design."
          line="It works on its own, but only where you let it."
        />
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 lg:grid-cols-5">
        {TRUST.map(({ icon: Icon, title, body }) => (
          <li key={title}>
            <Panel className="flex h-full flex-col items-center gap-3 px-4 py-6 text-center">
              <span className="bg-muted grid size-11 place-items-center rounded-full">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-0.5">
                <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
                <span className="text-foreground/70 text-[13.5px] leading-[1.4]">{body}</span>
              </span>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================ bananas

function Bananas({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="mt-16 sm:mt-24">
      <div className="bg-peel-center text-ink relative overflow-hidden">
        <div className="flex flex-col items-center gap-6 px-6 pt-[clamp(48px,6vw,80px)] text-center">
          <h2 className="display-title m-0 max-w-[780px] text-[clamp(38px,5.4vw,68px)] leading-[1.0] tracking-[-0.045em] text-balance">
            Running your organization shouldn&apos;t be bananas.
          </h2>
          <p className="text-bark-soft m-0 text-[17px]">Set it up once. Then let it run.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href={startHref(signedIn)}
              className="bg-ink text-cream hover:bg-ink-hover inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold whitespace-nowrap"
              data-cta="get_started"
              data-cta-location="final"
            >
              Get started free <ArrowRight />
            </Link>
            <SiteLink
              href={DEMO_HREF}
              className="border-ink/25 hover:bg-ink/5 inline-flex h-12 items-center rounded-full border px-6 text-[15px] font-semibold whitespace-nowrap"
              data-cta="request_demo"
              data-cta-location="final"
            >
              Request a demo
            </SiteLink>
          </div>
          <div
            aria-hidden="true"
            className="font-logo mt-[clamp(32px,5vw,64px)] -mb-[0.12em] text-[clamp(56px,15.5vw,196px)] leading-[0.78] tracking-[-0.05em] whitespace-nowrap"
          >
            bananasplit
          </div>
        </div>
      </div>
    </section>
  );
}

/** The home page's sections, inside MarketingShell (the header, footer and <main>). */
export function HomePage({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <Hero signedIn={signedIn} />
      <WorksWith />
      <OnTheGo />
      <Integrations />
      <MainFeatures />
      <Basics />
      <Security />
      <Bananas signedIn={signedIn} />
    </>
  );
}
