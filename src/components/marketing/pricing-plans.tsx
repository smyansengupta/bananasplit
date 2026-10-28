import { Check, Minus } from "@/components/icons";
import Link from "next/link";
import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { PLAN_LIMITS } from "@/lib/billing/features";
import {
  dollars,
  PERSONAL_PLANS,
  SCHOOL_LICENSE,
  TEAM_FREE_STORAGE_GB,
  TEAM_PRICES,
} from "@/lib/billing/plans";
import { formatStorage } from "@/lib/billing/storage";
import { TRIAL_DAYS } from "@/lib/billing/space";
import { cn } from "@/lib/utils";

import { DEMO_HREF, PRIMARY_CTA, SECONDARY_CTA, startHref } from "./links";
import { type PriceMode, PriceModeSwitch } from "./price-mode";
import { CONTAINER, SectionTitle } from "./section-title";
import { SiteLink } from "./site-link";

type Card = {
  name: string;
  /** Who it's for, under the name. */
  who: string;
  chip?: string;
  featured?: boolean;
  price: string;
  per: string;
  note?: string;
  bullets: readonly string[];
  cta: { label: string; href: string };
};

const { club: TEAM, society: ADVANCED } = TEAM_PRICES;

/** The four team cards in one mode: standard prices, or a verified student organization's. */
function teamCards(mode: PriceMode, signedIn: boolean): readonly Card[] {
  const start = startHref(signedIn);
  const student = mode === "student";
  return [
    {
      name: TEAM_PRICES.free.name,
      who: "For any team getting started",
      price: "$0",
      per: "free forever",
      note: `Unlimited members. New teams get ${TRIAL_DAYS} days of Team Advanced first.`,
      bullets: [
        "Tasks with every view",
        "Docs and databases",
        "Calendar and find-a-time polls",
        "Event pages and QR check-in",
        "Member directory",
        `${TEAM_FREE_STORAGE_GB} GB of files`,
      ],
      cta: { label: "Get started free", href: start },
    },
    {
      name: TEAM.name,
      who: student ? "For most student organizations" : "For growing teams",
      price: dollars(student ? TEAM.studentPerYear : TEAM.perMemberPerMonth),
      per: student ? "a year, flat" : "per member a month",
      note: student
        ? `Up to ${TEAM.studentMemberCap} members, who never pay. Or ${dollars(TEAM.studentPerSemester)} a semester.`
        : "Billed yearly.",
      bullets: [
        "Everything in Free",
        "Finance: budgets, transactions and reimbursements",
        "Org chart and handover",
        "Reports and attendance",
        `${PLAN_LIMITS.CLUB.dataConnections} data connections, ${formatStorage(PLAN_LIMITS.CLUB.storageBytes)}`,
      ],
      cta: { label: `Start with ${TEAM.name}`, href: start },
    },
    {
      name: ADVANCED.name,
      who: student ? "For large student organizations" : "For teams that run on it",
      chip: `${TRIAL_DAYS}-day trial`,
      featured: true,
      price: dollars(student ? ADVANCED.studentPerYear : ADVANCED.perMemberPerMonth),
      per: student ? "a year, flat" : "per member a month",
      note: student
        ? `Up to ${ADVANCED.studentMemberCap} members, who never pay. Or ${dollars(ADVANCED.studentPerSemester)} a semester.`
        : "Billed yearly.",
      bullets: [
        "Everything in Team",
        "AI suggestions and imports",
        "Sponsorships and runway",
        "Website sync, audit log and themes",
        `${PLAN_LIMITS.SOCIETY.dataConnections} data connections, ${formatStorage(PLAN_LIMITS.SOCIETY.storageBytes)}`,
      ],
      cta: { label: "Start free trial", href: start },
    },
    {
      name: "Custom",
      who: student ? "For schools" : "For companies",
      price: student ? dollars(SCHOOL_LICENSE.perOrgPerYear) : "Custom",
      per: student ? "per organization a year" : "one contract for every team",
      note: student
        ? `Every student organization on Team Advanced, ${dollars(SCHOOL_LICENSE.minimumPerYear)} minimum.`
        : undefined,
      bullets: student
        ? [
            "Every organization on Team Advanced",
            "An admin view for student activities",
            "One invoice, purchase orders welcome",
            "Security and accessibility review",
          ]
        : [
            "Everything in Team Advanced, for every team",
            "Admin controls across teams",
            "Invoicing and purchase orders",
            "Security review",
          ],
      cta: { label: "Request a demo", href: DEMO_HREF },
    },
  ];
}

/** The two personal cards in one mode. */
function personalCards(mode: PriceMode, signedIn: boolean): readonly Card[] {
  const plus = PERSONAL_PLANS.plus;
  return [
    {
      name: PERSONAL_PLANS.free.name,
      who: "For one person",
      price: "$0",
      per: "forever",
      bullets: [
        "Your tasks and calendar",
        "RSVP pages and polls",
        "Notes, files and databases, 1 GB",
      ],
      cta: signedIn
        ? { label: "Open Bananasplit", href: "/app" }
        : { label: "Sign up free", href: "/sign-up" },
    },
    {
      name: plus.name,
      who: "For one person",
      chip: mode === "student" ? "Free for students" : undefined,
      price: mode === "student" ? "$0" : dollars(plus.perMonth),
      per:
        mode === "student"
          ? "with a verified school email"
          : `a month, or ${dollars(plus.perYear)} a year`,
      bullets: [
        "Everything in Personal Free",
        "Themes, Google Calendar sync and AI imports",
        "25 GB and a year of note history",
      ],
      cta: signedIn
        ? { label: "Open Bananasplit", href: "/app" }
        : { label: "Sign up free", href: "/sign-up" },
    },
  ];
}

function PlanCard({ card, compact = false }: { card: Card; compact?: boolean }) {
  return (
    <div
      className={cn(
        "bg-card edge rounded-card relative flex flex-col gap-5 p-6",
        card.featured && "ring-foreground ring-2",
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="heading text-[18px]">{card.name}</h3>
          {card.chip && <Badge variant={card.featured ? "accent" : "secondary"}>{card.chip}</Badge>}
        </div>
        <span className="text-muted-foreground text-[14px]">{card.who}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={cn("numeral", compact ? "text-[36px]" : "text-[44px]")}>{card.price}</span>
        <span className="text-muted-foreground text-[13px]">{card.per}</span>
        {card.note && (
          <span className="text-muted-foreground mt-1 text-[13px] leading-[1.5] text-pretty">
            {card.note}
          </span>
        )}
      </div>
      <SiteLink
        href={card.cta.href}
        className={cn(card.featured ? PRIMARY_CTA : SECONDARY_CTA, "h-11 w-full")}
        data-cta={card.cta.label === "Request a demo" ? "request_demo" : "get_started"}
        data-cta-location={`pricing_${card.name.toLowerCase().replace(/\s+/g, "_")}`}
      >
        {card.cta.label}
      </SiteLink>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {card.bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2.5 text-[14px] leading-[1.5]">
            <Check className="mt-0.5 size-4 flex-none" aria-hidden="true" />
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Cards({ mode, signedIn }: { mode: PriceMode; signedIn: boolean }) {
  return (
    <div className="flex flex-col gap-16">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {teamCards(mode, signedIn).map((card) => (
          <PlanCard key={card.name} card={card} />
        ))}
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="heading text-[20px]">Just for you</h2>
          <p className="text-muted-foreground text-[15px]">
            Every account has a personal space, free, and can join any number of organizations.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {personalCards(mode, signedIn).map((card) => (
            <PlanCard key={card.name} card={card} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A cell in the comparison: included, not included, or a value ("100 GB"). */
type Mark = boolean | string;
type Row = { feature: string; marks: readonly [Mark, Mark, Mark, Mark] };

const ALL: Row["marks"] = [true, true, true, true];
const TEAM_UP: Row["marks"] = [false, true, true, true];
const ADVANCED_UP: Row["marks"] = [false, false, true, true];
const CUSTOM_ONLY: Row["marks"] = [false, false, false, true];

/**
 * What each team plan includes: Free, Team, Team Advanced, Custom. The app
 * gates features in src/lib/billing/features.ts; move them to match this
 * table when billing moves to the published plans.
 */
const SECTIONS: readonly { title: string; rows: readonly Row[] }[] = [
  {
    title: "Limits",
    rows: [
      { feature: "Members", marks: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      {
        feature: "Storage",
        marks: [
          `${TEAM_FREE_STORAGE_GB} GB`,
          formatStorage(PLAN_LIMITS.CLUB.storageBytes),
          formatStorage(PLAN_LIMITS.SOCIETY.storageBytes),
          "Custom",
        ],
      },
      {
        feature: "Data connections",
        marks: [
          false,
          String(PLAN_LIMITS.CLUB.dataConnections),
          String(PLAN_LIMITS.SOCIETY.dataConnections),
          "Custom",
        ],
      },
    ],
  },
  {
    title: "Work",
    rows: [
      { feature: "Tasks on a board, list, table, week, roadmap and dashboard", marks: ALL },
      { feature: "Docs with live editing, comments and version history", marks: ALL },
      { feature: "Databases with CSV and Excel import", marks: ALL },
      { feature: "Calendar, find-a-time polls and personal feeds", marks: ALL },
      { feature: "Event pages, waitlists and QR check-in", marks: ALL },
      { feature: "Guests RSVP and answer polls without an account", marks: ALL },
      { feature: "Member directory and roles", marks: ALL },
    ],
  },
  {
    title: "Operations",
    rows: [
      { feature: "Finance: budgets, transactions and reimbursements", marks: TEAM_UP },
      { feature: "Org chart with versions and handover", marks: TEAM_UP },
      { feature: "Reports and attendance", marks: TEAM_UP },
      { feature: "Pay by card or purchase order", marks: TEAM_UP },
    ],
  },
  {
    title: "Advanced",
    rows: [
      { feature: "AI suggestions and imports", marks: ADVANCED_UP },
      { feature: "Sponsorships and runway", marks: ADVANCED_UP },
      { feature: "Website sync for events and sign-ups", marks: ADVANCED_UP },
      { feature: "Audit log", marks: ADVANCED_UP },
      { feature: "Themes and branding", marks: ADVANCED_UP },
    ],
  },
  {
    title: "Admin",
    rows: [
      { feature: "One contract for every team", marks: CUSTOM_ONLY },
      { feature: "Admin controls across teams", marks: CUSTOM_ONLY },
      { feature: "Security review", marks: CUSTOM_ONLY },
    ],
  },
];

const COLUMNS = [TEAM_PRICES.free.name, TEAM.name, ADVANCED.name, "Custom"] as const;

function MarkCell({ mark }: { mark: Mark }) {
  if (typeof mark === "string") return <span className="font-semibold">{mark}</span>;
  return mark ? (
    <Check className="mx-auto size-4" aria-label="Included" />
  ) : (
    <Minus className="text-muted-foreground/60 mx-auto size-4" aria-label="Not included" />
  );
}

/** The comparison table; on phones it scrolls sideways with the feature column pinned. */
function Compare() {
  return (
    <section id="compare" className="flex scroll-mt-24 flex-col gap-8">
      <SectionTitle className="text-center text-[clamp(30px,3.6vw,44px)]">
        Compare team plans
      </SectionTitle>
      <div className="bg-card edge rounded-card overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[14px]">
          <thead>
            <tr className="border-border border-b">
              <th className="bg-card sticky left-0 p-5 text-left font-semibold">
                <span className="sr-only">Feature</span>
              </th>
              {COLUMNS.map((name) => (
                <th key={name} scope="col" className="w-[16%] p-5 text-center font-semibold">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <Fragment key={section.title}>
                <tr>
                  <th
                    colSpan={5}
                    scope="colgroup"
                    className="text-muted-foreground bg-card sticky left-0 px-5 pt-7 pb-2 text-left text-[13px] font-semibold"
                  >
                    {section.title}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.feature} className="border-border border-t">
                    <th
                      scope="row"
                      className="bg-card sticky left-0 px-5 py-3.5 text-left font-normal"
                    >
                      {row.feature}
                    </th>
                    {row.marks.map((mark, i) => (
                      <td key={COLUMNS[i]} className="px-5 py-3.5 text-center">
                        <MarkCell mark={mark} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * /pricing's body: the headline, the price switch over the team and
 * personal cards, the student note, then the comparison. Prices come from
 * src/lib/billing/plans.ts (TEAM_PRICES).
 */
export function PricingPlans({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <section className={cn(CONTAINER, "flex flex-col gap-16 pt-[clamp(56px,8vw,96px)] sm:gap-24")}>
      <div className="flex flex-col gap-10">
        <div className="mx-auto flex max-w-[760px] flex-col items-center gap-5 text-center">
          <SectionTitle as="h1" className="text-[clamp(42px,6vw,76px)] leading-[1] text-balance">
            Simple pricing that grows with your team.
          </SectionTitle>
          <p className="text-foreground/80 max-w-[600px] text-[18px] leading-[1.55] text-pretty">
            Start free with unlimited members. Pay when you need finance, reports or AI. Student
            groups pay one flat price a year.
          </p>
        </div>
        <PriceModeSwitch
          standard={<Cards mode="standard" signedIn={signedIn} />}
          student={<Cards mode="student" signedIn={signedIn} />}
        />
        <div
          id="student"
          className="bg-muted/60 rounded-block mx-auto flex max-w-[880px] scroll-mt-24 flex-col gap-2 px-6 py-5 text-center text-[14px] leading-[1.6] text-pretty"
        >
          <span className="font-semibold">How student pricing works</span>
          <span className="text-muted-foreground">
            The organization&apos;s owner verifies a school email once, and the flat price applies
            for the academic year, August to May, with no summer bills. At the officer handover the
            new owner verifies and the price carries over. Teams that leave school keep everything
            and move to the standard price.{" "}
            <Link
              href="#custom"
              className="text-foreground font-semibold underline-offset-4 hover:underline"
            >
              Licensing a whole school?
            </Link>
          </span>
        </div>
      </div>
      <span id="custom" className="-mt-16 scroll-mt-24 sm:-mt-24" aria-hidden="true" />
      <Compare />
    </section>
  );
}
