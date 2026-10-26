import { Check, Minus } from "@/components/icons";
import { Fragment, type ReactNode } from "react";

import { pill } from "@/components/brand/pill";
import { Badge } from "@/components/ui/badge";
import { PLAN_LIMITS } from "@/lib/billing/features";
import { dollars } from "@/lib/billing/plans";
import { CONTACT_HREF } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

import { AudienceSwitch } from "./audience-switch";
import { PlusToggle } from "./plus-toggle";
import { CONTAINER, SectionTitle } from "./section-title";
import { SiteLink } from "./site-link";
import {
  PERSONAL_PLUS,
  perMemberRate,
  TIER_LIMITS,
  TIER_NAMES,
  type TierId,
  type TierLimits,
} from "./tiers";

type Tier = {
  id: TierId;
  /** Who it's for, above the name. */
  who: string;
  /** The chip beside "who" (New, 30-day trial). */
  chip?: { label: string; variant: "accent" | "secondary" };
  /** The recommended tier: ringed in the accent with the glow under it, and the glow button. */
  featured?: boolean;
  price: string;
  per: string;
  note: string;
  bullets: readonly ReactNode[];
  cta: { label: string; href: string };
};

/** Where "start a club" goes: straight to setup when signed in, else sign-up first. */
function createClubHref(signedIn: boolean): string {
  return signedIn
    ? "/onboarding/organization"
    : "/sign-up?callbackUrl=%2Fonboarding%2Forganization";
}

/** Personal Free's button: the app when signed in, else sign-up. */
function personalCta(signedIn: boolean): Tier["cta"] {
  return signedIn
    ? { label: "Open Personal", href: "/app" }
    : { label: "Sign up free", href: "/sign-up" };
}

/**
 * Personal Plus's button: checkout (?plan=plus) where checkout exists, by
 * way of sign-up when signed out; elsewhere (production until billing is
 * connected) the same as Personal Free's, since there's nothing to buy yet.
 */
function plusCta(signedIn: boolean, checkout: boolean): Tier["cta"] {
  if (!checkout) return personalCta(signedIn);
  return {
    label: "Get Personal Plus",
    href: signedIn ? "/checkout?plan=plus" : "/sign-up?callbackUrl=%2Fcheckout%3Fplan%3Dplus",
  };
}

function tiers(signedIn: boolean, checkout: boolean): readonly Tier[] {
  const club = createClubHref(signedIn);
  const team = perMemberRate("club");
  return [
    {
      id: "free",
      who: "For one person",
      price: "$0",
      per: "forever",
      note: "Every account has one, and you can join any club.",
      bullets: [
        "Tasks, calendar, find a time and RSVPs",
        <>
          Notes, files and databases{" "}
          <Badge variant="accent" className="ml-0.5 h-5 px-2 align-[1px] text-[11px]">
            New
          </Badge>
        </>,
        "Tags and the weekly pulse",
      ],
      cta: personalCta(signedIn),
    },
    {
      id: "plus",
      who: "For one person",
      chip: { label: "New", variant: "accent" },
      price: dollars(PERSONAL_PLUS.perMonth),
      per: `a month, or ${dollars(PERSONAL_PLUS.perYear)} a year`,
      note: "Yearly is three months free.",
      bullets: [
        "Everything in Personal Free",
        "Themes, calendar sync and AI imports",
        "Longer note history and bigger files",
      ],
      cta: plusCta(signedIn, checkout),
    },
    {
      id: "club",
      who: "For a club",
      price: dollars(team),
      per: "per member per semester",
      note: `A 40-member club pays ${dollars(40 * team)} a semester.`,
      bullets: [
        "The club's Overview, people, finance, databases, reports and integrations",
        "Projects, epics and the roadmap",
      ],
      cta: { label: "Start a club", href: club },
    },
    {
      id: "society",
      who: "For a big club or society",
      chip: { label: "30-day trial", variant: "secondary" },
      featured: true,
      price: dollars(perMemberRate("society")),
      per: "per member per semester",
      note: "Every new club starts here, free for 30 days, no card.",
      bullets: [
        "Everything in Team, plus themes, AI, sponsorships, website sync and the audit log",
        "An AI summary in the weekly pulse",
      ],
      cta: { label: "Start your free trial", href: club },
    },
  ];
}

/** A cell in the comparison: included, not included, or a value ("25 GB"). */
type Mark = boolean | string;

type Row = { feature: string; marks: readonly [Mark, Mark, Mark, Mark] };

type Section = { title: string; rows: readonly Row[] };

const LIMIT_ROWS: readonly { feature: string; key: keyof TierLimits }[] = [
  { feature: "Storage", key: "storage" },
  { feature: "Largest file", key: "largestFile" },
  { feature: "Note history", key: "noteHistory" },
  { feature: "Members", key: "members" },
];

const ORDER: readonly TierId[] = ["free", "plus", "club", "society"];

/**
 * What each plan includes, one column per tier in the card order (Personal
 * Free, Personal Plus, Team, Team Advanced). The app gates the same
 * features (src/lib/billing/features.ts, src/lib/billing/space.ts): change
 * the two together.
 */
const SECTIONS: readonly Section[] = [
  {
    title: "Limits",
    rows: LIMIT_ROWS.map(({ feature, key }) => ({
      feature,
      marks: [
        TIER_LIMITS.free[key],
        TIER_LIMITS.plus[key],
        TIER_LIMITS.club[key],
        TIER_LIMITS.society[key],
      ],
    })),
  },
  {
    title: "Free for everyone",
    rows: [
      { feature: "Tasks on a board, a week and a table", marks: [true, true, true, true] },
      { feature: "A calendar and find a time", marks: [true, true, true, true] },
      { feature: "RSVP pages, waitlists and QR check-in", marks: [true, true, true, true] },
      { feature: "Notes and files", marks: [true, true, true, true] },
      { feature: "Databases and spreadsheets with CSV import", marks: [true, true, true, true] },
      { feature: "Tags and the weekly pulse", marks: [true, true, true, true] },
      { feature: "Join any club", marks: [true, true, true, true] },
    ],
  },
  {
    title: "For you",
    rows: [
      { feature: "Themes", marks: [false, true, false, true] },
      { feature: "Calendar sync with Google Calendar", marks: [false, true, true, true] },
      { feature: "AI imports", marks: [false, true, false, true] },
    ],
  },
  {
    title: "Your club",
    rows: [
      { feature: "Members, invitations and roles", marks: [false, false, true, true] },
      { feature: "The club's Overview and weekly updates", marks: [false, false, true, true] },
      { feature: "Member directory and org chart", marks: [false, false, true, true] },
      { feature: "Finance board and reimbursements", marks: [false, false, true, true] },
      {
        feature: "Attendance, sign-up and vote databases, and reports",
        marks: [false, false, true, true],
      },
      {
        feature: "Data connections",
        marks: [
          false,
          false,
          String(PLAN_LIMITS.CLUB.dataConnections),
          String(PLAN_LIMITS.SOCIETY.dataConnections),
        ],
      },
      { feature: "Projects, epics and the roadmap", marks: [false, false, true, true] },
    ],
  },
  {
    title: "For big clubs",
    rows: [
      { feature: "Club themes and branding", marks: [false, false, false, true] },
      {
        feature: "AI that creates tasks and events and sorts your data",
        marks: [false, false, false, true],
      },
      { feature: "Sponsorship tracking and runway", marks: [false, false, false, true] },
      { feature: "Website sync for events and sign-ups", marks: [false, false, false, true] },
      { feature: "Audit log", marks: [false, false, false, true] },
      { feature: "An AI summary in the weekly pulse", marks: [false, false, false, true] },
    ],
  },
];

const SCHOOL_PERKS = [
  "Every club gets Team Advanced",
  "Club creation by admins, invite code or open sign-up",
  "One invoice per semester for the whole school",
] as const;

const PROMISES = [
  "Cancel anytime",
  "Export your data whenever you want",
  "Student pricing needs a school email",
] as const;

/**
 * The four plans (redesign guide 11.1), two at a time behind a Personal /
 * Teams switch: Personal Free and Personal Plus for one person, Team and
 * Team Advanced for a club, as two cards side by side (stacked on a phone),
 * what each includes in a table underneath, and under the team plans the
 * school-wide plan. `checkout`: whether checkout exists on this
 * deployment (src/app/checkout/availability.ts), so Personal Plus only
 * links there when it does.
 */
export function Pricing({
  signedIn = false,
  checkout = false,
}: {
  signedIn?: boolean;
  checkout?: boolean;
}) {
  const plans = tiers(signedIn, checkout);
  const personalPlans = plans.filter((t) => t.id === "free" || t.id === "plus");
  const teamPlans = plans.filter((t) => t.id === "club" || t.id === "society");

  return (
    <section id="pricing" className={cn(CONTAINER, "flex flex-col gap-8 py-20 sm:gap-12 sm:py-32")}>
      <div className="flex flex-col items-center gap-[18px] text-center">
        <SectionTitle>Free for you. Simple pricing for your club.</SectionTitle>
        <p className="text-muted-foreground max-w-[620px] text-[16px] leading-[1.55] text-pretty sm:text-[17px]">
          Personal Free is yours forever: your own tasks, calendar, notes and RSVP pages, and you
          can join any club. Clubs pay per member, per semester, and every new club gets 30 days of
          Team Advanced, no card. Joining members never pay, and guests who just RSVP are always
          free.
        </p>
      </div>

      <AudienceSwitch
        personal={<PlanGroup plans={personalPlans} />}
        teams={
          <>
            <PlanGroup plans={teamPlans} />
            <SchoolsPanel />
          </>
        }
      />

      <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-[14px] sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-7 sm:gap-y-2">
        {PROMISES.map((promise, i) => (
          <Fragment key={promise}>
            {i > 0 && (
              <span aria-hidden="true" className="hidden opacity-50 sm:inline">
                ·
              </span>
            )}
            <span>{promise}</span>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

/** Two plans side by side, and what they include in a table underneath. */
function PlanGroup({ plans }: { plans: readonly Tier[] }) {
  return (
    <>
      <div className="mx-auto grid w-full max-w-[900px] items-stretch gap-4.5 md:grid-cols-2">
        {plans.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>
      <div className="mx-auto w-full max-w-[900px]">
        <ComparisonTable plans={plans} />
      </div>
    </>
  );
}

/**
 * A plan's card: who it's for, its name and price, its limits, what it
 * adds, and its button. The button sits at the bottom (mt-auto) and the
 * cards in a row stretch to the same height, so every button lines up
 * across the row whatever the copy above it.
 */
function TierCard({ tier }: { tier: Tier }) {
  const limits = TIER_LIMITS[tier.id];
  return (
    <div
      className={cn(
        "bg-card text-card-foreground rounded-card relative flex min-w-0 flex-col gap-5 p-6 sm:p-7",
        tier.featured
          ? "shadow-[0_0_0_2px_var(--brand-accent),0_18px_40px_-20px_color-mix(in_oklab,var(--glow)_55%,transparent)]"
          : "edge ring-foreground/6 ring-1",
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <span className="text-muted-foreground text-[13px] font-medium">{tier.who}</span>
          {tier.chip && <Badge variant={tier.chip.variant}>{tier.chip.label}</Badge>}
        </div>
        <h3 className="display-title m-0 text-[24px]">{TIER_NAMES[tier.id]}</h3>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="numeral text-[44px]">{tier.price}</span>
          <span className="text-muted-foreground text-[14px] leading-[1.3]">{tier.per}</span>
        </div>
        <span className="text-muted-foreground text-[13px] leading-[1.45] md:min-h-[2.9em]">
          {tier.note}
        </span>
      </div>
      <dl className="border-border m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 border-y py-3.5 text-[14px]">
        {LIMIT_ROWS.map(({ feature, key }) => (
          <Fragment key={key}>
            <dt className="text-muted-foreground">{feature}</dt>
            <dd className="m-0 text-right font-semibold tabular-nums">{limits[key]}</dd>
          </Fragment>
        ))}
      </dl>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[14px] leading-[1.45]">
        {tier.bullets.map((bullet, i) => (
          <li key={i} className="flex gap-2.5">
            <Check className="text-muted-foreground mt-0.5 size-4 flex-none" aria-hidden="true" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <SiteLink
        href={tier.cta.href}
        className={cn(
          pill({ tone: tier.featured ? "glow" : "outline", size: "md" }),
          "mt-auto w-full",
        )}
      >
        {tier.cta.label}
      </SiteLink>
    </div>
  );
}

/** One cell: a check, a muted dash, or a value. */
function MarkCell({ mark, featured }: { mark: Mark; featured?: boolean }) {
  return (
    <td className={cn("px-3 py-3 text-center align-middle", featured && "bg-muted/50")}>
      {mark === true ? (
        <span className="bg-tint-success text-tint-success-foreground inline-grid size-6 place-items-center rounded-full">
          <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
          <span className="sr-only">Included</span>
        </span>
      ) : mark === false ? (
        <span className="text-muted-foreground/60 inline-grid size-6 place-items-center">
          <Minus className="size-4" aria-hidden="true" />
          <span className="sr-only">Not included</span>
        </span>
      ) : (
        <span className="text-[14px] font-semibold tabular-nums">{mark}</span>
      )}
    </td>
  );
}

/**
 * Every plan's features in one table: a row per feature, a column per plan,
 * grouped under headings, behind a "Compare every plan" toggle (a native
 * <details>, like the FAQs) so the cards stay the first thing you see.
 * Scrolls sideways on a narrow phone rather than squeezing the plan names.
 */
function ComparisonTable({ plans }: { plans: readonly Tier[] }) {
  return (
    <details className="group bg-card edge ring-foreground/6 rounded-card w-full ring-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-5 py-4 text-[16px] font-semibold sm:px-7 sm:py-5 [&::-webkit-details-marker]:hidden">
        Compare every plan
        <PlusToggle />
      </summary>
      <div className="overflow-x-auto px-2 pb-3 sm:px-4">
        <table className="w-full min-w-[480px] border-collapse text-left">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr>
              <th scope="col" className="text-muted-foreground px-3 py-3 text-[13px] font-medium">
                <span className="sr-only">Feature</span>
              </th>
              {ORDER.map((id, i) => (
                <th
                  key={id}
                  scope="col"
                  className={cn(
                    "rounded-t-tile w-[17%] px-3 py-3 text-center text-[14px] font-semibold",
                    plans[i]?.featured && "bg-muted/50",
                  )}
                >
                  {TIER_NAMES[id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <Fragment key={section.title}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={ORDER.length + 1}
                    className="text-muted-foreground px-3 pt-6 pb-2 text-[13px] font-semibold"
                  >
                    {section.title}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.feature} className="border-border border-t">
                    <th scope="row" className="px-3 py-3 text-[14px] leading-[1.4] font-normal">
                      {row.feature}
                    </th>
                    {row.marks.map((mark, i) => (
                      <MarkCell key={i} mark={mark} featured={plans[i]?.featured} />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The dark "For schools" panel, under the club plans only. */
function SchoolsPanel() {
  return (
    <div className="bg-night text-cream relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-center gap-x-14 gap-y-8 overflow-hidden rounded-[28px] p-[clamp(28px,4vw,48px)]">
      <span
        aria-hidden="true"
        className="bg-glow-banana-20 absolute -top-[140px] -right-[120px] size-[380px] rounded-full"
      />
      <div className="relative flex flex-col gap-3.5">
        <span className="text-banana text-[14px] font-bold">For schools</span>
        <h3 className="font-heading text-[clamp(28px,3vw,40px)] leading-[1.06] tracking-[-0.025em] text-balance">
          Run every club on campus from one place.
        </h3>
        <p className="text-dusk max-w-[480px] text-[16px] leading-[1.6]">
          Platform plans host all your clubs under one school, with platform admins deciding who can
          start a club. One per-member, per-semester rate across campus, with volume discounts.
        </p>
      </div>
      <div className="relative flex flex-col items-start gap-5">
        <div className="text-dusk-light flex flex-col gap-2.5 text-[15px]">
          {SCHOOL_PERKS.map((perk) => (
            <span key={perk} className="flex gap-2.5">
              <span className="text-banana">✓</span>
              {perk}
            </span>
          ))}
        </div>
        <SiteLink
          href={CONTACT_HREF}
          className="bg-banana text-ink hover:bg-lemon hover:text-ink rounded-full px-[22px] py-[13px] text-[15px] font-semibold whitespace-nowrap"
        >
          Talk to us
        </SiteLink>
      </div>
    </div>
  );
}
