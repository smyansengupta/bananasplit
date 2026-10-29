"use client";

import { ChevronDown, Info, Minus, Plus } from "@/components/icons";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import { ArrowLeft } from "@/components/brand/arrows";
import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { Segmented } from "@/components/ui/segmented";
import { FieldSelect } from "@/components/ui/field-select";
import {
  type ClubPlanId,
  dollars,
  PERSONAL_PLANS,
  type PriceTrack,
  type StudentTerm,
  TEAM_PRICES,
  teamQuote,
} from "@/lib/billing/plans";
import { PRIVACY_HREF, TERMS_HREF } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

/** "$280.00", "$1,400.00". */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const NOT_CONNECTED = "Card payments aren't connected yet, so nothing was charged.";

/** What checkout sells: a team plan (?plan=club is Team, society is Team Advanced) or Personal Plus. */
export type CheckoutPlan = ClubPlanId | "plus";

const PLUS = PERSONAL_PLANS.plus;

/** The plan's name on the order. */
function planName(plan: CheckoutPlan): string {
  return plan === "plus" ? PLUS.name : TEAM_PRICES[plan].name;
}

type Period = "month" | "year";

/*
 * Stripe-style fields in Moonstone: 40px (44 on touch screens), 14px
 * corners, the glow focus ring. Their text has no set line-height (the page
 * sets `leading-[normal]`), so sizes are plain pixel values.
 */
const LABEL = "text-[13px] font-medium text-muted-foreground";
const FIELD =
  "h-10 rounded-field border border-input bg-card px-3.5 text-base text-foreground focus-banana outline-none transition-[border-color,box-shadow] sm:text-[15px] pointer-coarse:h-11";
/** A grouped field (card, country + ZIP): one frame, the halo on the frame. */
const GROUP =
  "overflow-hidden rounded-field border border-input bg-card focus-within-banana transition-[border-color,box-shadow]";
/** An input inside a group: no frame of its own. */
const GROUP_INPUT =
  "h-10 bg-transparent px-3.5 text-base text-foreground outline-none sm:text-[15px] pointer-coarse:h-11";

const COUNTRIES = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["IN", "India"],
  ["SG", "Singapore"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["NL", "Netherlands"],
  ["MX", "Mexico"],
] as const;

export interface CheckoutFormProps {
  plan: CheckoutPlan;
  /** The organization the plan is for ("your organization" with none); unused for Personal Plus. */
  clubName: string;
  /** The organization's member count (at least 1), or the sample 40 with none. */
  initialMembers: number;
  email: string;
  /** Whether `email` is a school's (isSchoolEmail): the student prices are offered. */
  schoolEmail: boolean;
  backHref: string;
  backLabel: string;
  /**
   * When each kind of plan renews ("Aug 25, 2027"): standard a year from
   * today, student at the next academic year or semester (placeholder
   * dates; see src/lib/billing/semester.ts).
   */
  renews: { standard: string; year: string; semester: string };
}

/**
 * Checkout, Stripe Checkout style, in Moonstone: the order on the page
 * (left), the card form in a card (right). Stacked below lg, the order on
 * top. A team plan is per member a month, billed yearly, or for a student
 * organization a flat price per academic year or semester; Personal Plus
 * is one person, monthly or yearly.
 *
 * Billing isn't connected: Subscribe only says so. The form never submits
 * anywhere (onSubmit prevents it, and no field has a `name`, so even a
 * pre-hydration submit carries nothing).
 */
export function CheckoutForm(props: CheckoutFormProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const headingId = useId();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(NOT_CONNECTED);
  }

  return (
    <main className="flex flex-1 flex-col leading-[normal] lg:flex-row">
      <section
        aria-label="Order summary"
        className="flex min-w-0 justify-center px-4 pt-10 pb-8 sm:px-6 lg:flex-1 lg:justify-end lg:px-16 lg:py-16"
      >
        <div className="flex w-full max-w-[440px] flex-col gap-7">
          <Link
            href={props.backHref}
            aria-label={props.backLabel}
            className="group/back flex items-center gap-3 self-start"
            data-plain
          >
            <span className="border-input group-hover/back:bg-muted grid size-8 place-items-center rounded-full border transition-colors">
              <ArrowLeft />
            </span>
            <span className="logo-lockup">
              <Logo size={24} textSize={18} />
            </span>
          </Link>
          {props.plan === "plus" ? (
            <PlusOrder {...props} />
          ) : (
            <ClubOrder {...props} plan={props.plan} />
          )}
        </div>
      </section>

      {/*
        Payment. min-w-0 on both halves keeps them equal near lg, where the
        columns shrink below 440px (the inputs' intrinsic widths would
        otherwise win).
      */}
      <div className="flex min-w-0 flex-1 justify-center px-4 pb-12 sm:px-6 lg:justify-start lg:px-16 lg:py-16">
        <form
          noValidate
          aria-labelledby={headingId}
          onSubmit={onSubmit}
          className="bg-card text-card-foreground edge ring-foreground/6 rounded-card flex w-full max-w-[440px] flex-col gap-5 self-start p-5 ring-1 sm:p-7"
        >
          <h2 id={headingId} className="heading text-[19px]">
            Pay with card
          </h2>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Email</span>
            <input
              type="email"
              value={props.email}
              readOnly
              className={cn(FIELD, "bg-muted text-muted-foreground")}
            />
          </label>

          <CardFieldsPlaceholder />

          <div className="mt-1 flex flex-col">
            <button type="submit" className={cn(pill(), "w-full")}>
              Subscribe
            </button>
            {/* Always mounted, so the message is announced when it appears. */}
            <p role="status" className="text-muted-foreground text-center text-[13px]">
              {notice && <span className="block pt-2.5">{notice}</span>}
            </p>
          </div>
          <p className="text-muted-foreground text-center text-[12px] leading-[1.5]">
            By subscribing, you allow Bananasplit to charge your card for this payment and future
            renewals. Cancel any time in{" "}
            {props.plan === "plus" ? "your profile" : "organization settings"}.
          </p>

          <div className="text-muted-foreground flex justify-center gap-3.5 text-[12px]">
            <span>
              Powered by <b className="text-foreground font-semibold">stripe</b>
            </span>
            <span aria-hidden="true">|</span>
            <a href={TERMS_HREF} className="hover:text-foreground">
              Terms
            </a>
            <a href={PRIVACY_HREF} className="hover:text-foreground">
              Privacy
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}

/** The plan's name and the total, big. */
function OrderTotal({ plan, total, per }: { plan: CheckoutPlan; total: string; per: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-muted-foreground text-[16px] font-medium">
        Subscribe to {planName(plan)}
      </h1>
      <p className="flex items-baseline gap-2.5">
        <span className="numeral text-[44px]">{total}</span>
        <span className="text-muted-foreground text-[15px] leading-[1.25]">{per}</span>
      </p>
    </div>
  );
}

/** A note in the order (seats, yearly savings). */
function OrderNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted text-muted-foreground rounded-tile flex gap-2.5 px-3.5 py-3 text-[13px] leading-[1.5]">
      <Info className="text-foreground mt-px size-4 flex-none" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** A label and an amount on one line of the receipt. */
function OrderLine({
  label,
  amount,
  strong = false,
  muted = false,
}: {
  label: string;
  amount: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between text-[15px]",
        strong && "text-[16px] font-semibold",
        muted && "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{amount}</span>
    </div>
  );
}

/**
 * A team plan. Standard: the seat stepper, per member a month, billed
 * yearly. Student (a school address, within the plan's member cap): a flat
 * price for the academic year or a semester, whatever the member count.
 */
function ClubOrder({
  plan,
  clubName,
  initialMembers,
  schoolEmail,
  renews,
}: CheckoutFormProps & { plan: ClubPlanId }) {
  const [members, setMembers] = useState(initialMembers);
  const [chosen, setChosen] = useState<PriceTrack | null>(null);
  const [term, setTerm] = useState<StudentTerm>("year");
  const prices = TEAM_PRICES[plan];
  const studentOk = schoolEmail && members <= prices.studentMemberCap;
  const track: PriceTrack = studentOk ? (chosen ?? "student") : "standard";
  const quote = teamQuote(plan, track, members, term);
  const total = usd.format(quote.total);
  const name = prices.name;
  const renewsOn = track === "standard" ? renews.standard : renews[term];
  return (
    <>
      <OrderTotal plan={plan} total={total} per={quote.per.replace(/^a /, "per ")} />
      {schoolEmail && (
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Price"
            value={track}
            onSelect={(value) => setChosen(value as PriceTrack)}
            options={[
              { value: "student", label: "Student organization" },
              { value: "standard", label: "Standard" },
            ]}
          />
          {track === "student" && (
            <Segmented
              label="Billing period"
              value={term}
              onSelect={(value) => setTerm(value as StudentTerm)}
              options={[
                { value: "year", label: "Academic year" },
                { value: "semester", label: "Semester" },
              ]}
            />
          )}
        </div>
      )}
      <div className="flex flex-col gap-4">
        <div className="flex justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="text-[15px] font-semibold">
              {name} · {clubName}
            </span>
            <span className="text-muted-foreground flex items-center gap-2 text-[13px]">
              <span className="bg-muted inline-flex h-8 items-center rounded-full p-0.5">
                <button
                  type="button"
                  aria-label="Fewer members"
                  onClick={() => setMembers((n) => Math.max(1, n - 1))}
                  className="hover:bg-card grid size-7 cursor-pointer place-items-center rounded-full transition-colors active:scale-[0.94]"
                >
                  <Minus className="size-3.5" aria-hidden="true" />
                </button>
                <output
                  aria-live="polite"
                  className="text-foreground min-w-10 text-center text-[14px] font-semibold tabular-nums"
                >
                  {members}
                </output>
                <button
                  type="button"
                  aria-label="More members"
                  onClick={() => setMembers((n) => n + 1)}
                  className="hover:bg-card grid size-7 cursor-pointer place-items-center rounded-full transition-colors active:scale-[0.94]"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              </span>
              {track === "standard" ? (
                <>
                  {/* Two flex items: the gap sets "$8" apart. */}
                  <span>members ×</span>
                  <span>{dollars(prices.perMemberPerMonth)} a month</span>
                </>
              ) : (
                <span>members, flat</span>
              )}
            </span>
          </div>
          <span className="text-[15px] font-semibold tabular-nums">{total}</span>
        </div>

        <OrderNote>
          {track === "student"
            ? `${quote.basis} Student organizations of up to ${prices.studentMemberCap} members pay one price, billed for the ${term === "year" ? "academic year, August to May, never the summer" : "semester"}.`
            : schoolEmail && members > prices.studentMemberCap
              ? `Student pricing covers up to ${prices.studentMemberCap} members, so this is the standard price: ${quote.basis.toLowerCase()}.`
              : `${quote.basis}. Pick how many members you have now; new members can join any time and are billed at renewal, not today.`}
        </OrderNote>

        <div className="bg-border h-px" />
        <OrderLine label="Subtotal" amount={total} />
        <OrderLine
          label={track === "student" ? "Student price" : "Standard price"}
          amount={track === "student" ? "Applied" : "Billed yearly"}
          muted
        />
        <div className="bg-border h-px" />
        <OrderLine label="Total due today" amount={total} strong />
        <span className="text-muted-foreground text-[13px]">
          Renews {renewsOn}
          {track === "student"
            ? ` for the next ${term === "year" ? "academic year" : "semester"}`
            : ""}
          .
        </span>
      </div>
    </>
  );
}

/** Personal Plus: one person, billed monthly or yearly. */
function PlusOrder({ email }: CheckoutFormProps) {
  const [period, setPeriod] = useState<Period>("year");
  const amount = period === "year" ? PLUS.perYear : PLUS.perMonth;
  const total = usd.format(amount);
  const saved = usd.format(PLUS.perMonth * 12 - PLUS.perYear);
  return (
    <>
      <OrderTotal plan="plus" total={total} per={period === "year" ? "per year" : "per month"} />
      <div className="flex flex-col gap-4">
        <Segmented
          label="Billing period"
          value={period}
          onSelect={(value) => setPeriod(value as Period)}
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Yearly" },
          ]}
          className="self-start"
        />
        <div className="flex justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[15px] font-semibold">{PLUS.name}</span>
            <span className="text-muted-foreground truncate text-[13px]">For {email}</span>
          </div>
          <span className="text-[15px] font-semibold tabular-nums">{total}</span>
        </div>

        <OrderNote>
          {period === "year"
            ? `Yearly saves ${saved}: three months free. Your Personal space gets integrations, 25 GB, files up to 250 MB and a year of note history.`
            : `Switch to yearly to save ${saved}. Your Personal space gets integrations, 25 GB, files up to 250 MB and a year of note history.`}
        </OrderNote>

        <div className="bg-border h-px" />
        <OrderLine label="Total due today" amount={total} strong />
        <span className="text-muted-foreground text-[13px]">
          Renews every {period === "year" ? "year" : "month"} until you cancel.
        </span>
      </div>
    </>
  );
}

/**
 * A visual stand-in for Stripe's Payment Element (card number, expiry, CVC,
 * cardholder name, country and ZIP). Production replaces this whole block
 * with the Payment Element, styled with these colours through Stripe's
 * Appearance API. Card data must go from the browser straight to Stripe and
 * never be posted to our own server: that's why these fields have no `name`
 * and autocomplete is off.
 */
function CardFieldsPlaceholder() {
  const countryId = useId();
  return (
    <>
      <fieldset className="min-w-0">
        <legend className={cn(LABEL, "float-left mb-1.5 w-full")}>Card information</legend>
        <div className={cn(GROUP, "clear-both")}>
          <div className="border-input flex items-center border-b">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Card number"
              placeholder="1234 1234 1234 1234"
              autoComplete="off"
              className={cn(GROUP_INPUT, "min-w-0 flex-1")}
            />
            <span aria-hidden="true" className="flex gap-1 pr-3">
              <span className="bg-card-visa h-5 w-[30px] rounded-[4px]" />
              <span className="bg-card-mc h-5 w-[30px] rounded-[4px]" />
              <span className="bg-card-amex h-5 w-[30px] rounded-[4px]" />
            </span>
          </div>
          <div className="flex">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Expiration date (MM / YY)"
              placeholder="MM / YY"
              autoComplete="off"
              className={cn(GROUP_INPUT, "border-input min-w-0 flex-1 border-r")}
            />
            <input
              type="text"
              inputMode="numeric"
              aria-label="Security code (CVC)"
              placeholder="CVC"
              autoComplete="off"
              className={cn(GROUP_INPUT, "min-w-0 flex-1")}
            />
          </div>
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Cardholder name</span>
        <input type="text" placeholder="Full name on card" autoComplete="off" className={FIELD} />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={countryId} className={LABEL}>
          Country or region
        </label>
        <div className={GROUP}>
          <div className="border-input relative flex items-center border-b">
            <FieldSelect
              id={countryId}
              defaultValue="US"
              className={cn(GROUP_INPUT, "w-full cursor-pointer appearance-none pr-9")}
            >
              {COUNTRIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </FieldSelect>
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute right-3.5 size-4"
            />
          </div>
          <input
            type="text"
            aria-label="ZIP"
            placeholder="ZIP"
            autoComplete="off"
            className={cn(GROUP_INPUT, "w-full")}
          />
        </div>
      </div>
    </>
  );
}
