import type { OrgPlan } from "@/generated/prisma/enums";

import { PLAN_NAMES } from "./features";

/**
 * Bananasplit's prices (the Bananasplit business model, October 2026): the
 * one place they live. /pricing, checkout and Settings › Plan and storage
 * read from here, and so should the billing provider's price ids once
 * billing is connected. Names come from PLAN_NAMES and what each plan
 * includes from src/lib/billing/features.ts.
 *
 * Two families. Personal, for one person: Free, and Plus at $4 a month or
 * $36 a year (free for students). Teams, for any group: Free (unlimited
 * members), Team and Team Advanced. Team plans have two prices:
 *
 *   standard   per member a month, billed yearly.
 *   student    a flat price per academic year (or a semester, for an
 *              organization with only a supplemental grant), up to a member
 *              cap, for a student organization. Its members never pay.
 *
 * Who gets the student price is studentPricing() below.
 *
 * The keys are checkout's query values (?plan=club is Team, ?plan=society
 * Team Advanced, ?plan=plus Personal Plus), so they keep their old names.
 */

export const TEAM_PRICES = {
  free: { plan: "TEAM_FREE", name: PLAN_NAMES.TEAM_FREE, perMemberPerMonth: 0 },
  club: {
    plan: "CLUB",
    name: PLAN_NAMES.CLUB,
    perMemberPerMonth: 8,
    studentPerYear: 199,
    studentPerSemester: 119,
    studentMemberCap: 100,
  },
  society: {
    plan: "SOCIETY",
    name: PLAN_NAMES.SOCIETY,
    perMemberPerMonth: 16,
    studentPerYear: 449,
    studentPerSemester: 269,
    studentMemberCap: 300,
  },
} as const;

export const PERSONAL_PLANS = {
  free: { plan: "FREE", name: PLAN_NAMES.FREE, perMonth: 0, perYear: 0 },
  plus: { plan: "PERSONAL_PLUS", name: PLAN_NAMES.PERSONAL_PLUS, perMonth: 4, perYear: 36 },
} as const;

/** Personal Plus for a student: free while the school email holds. */
export const PERSONAL_PLUS_STUDENT_PER_MONTH = 0;

/** A custom contract for a school: every student organization on Team Advanced. */
export const SCHOOL_LICENSE = { perOrgPerYear: 25, minimumPerYear: 7500 } as const;

/** Storage on Team Free, as /pricing prints it (PLAN_LIMITS.TEAM_FREE). */
export const TEAM_FREE_STORAGE_GB = 5;

/** The paid team plans, by checkout key. */
export type ClubPlanId = "club" | "society";
export type PersonalPlanId = keyof typeof PERSONAL_PLANS;

export function isClubPlanId(value: unknown): value is ClubPlanId {
  return value === "club" || value === "society";
}

/** A paid team plan's checkout key ("club", "society") from its plan value. */
export function clubPlanIdOf(plan: OrgPlan): ClubPlanId | null {
  return plan === "CLUB" ? "club" : plan === "SOCIETY" ? "society" : null;
}

// ---------------------------------------------------------------- Student pricing

export type PriceTrack = "standard" | "student";

/** How often a student plan bills: once an academic year, or once a semester. */
export type StudentTerm = "year" | "semester";

/**
 * Whether an address is a school's. Interim rule until school email
 * verification exists (the business model's "verify once"): the account's
 * own address, which sign-up already verifies, is on a school domain: .edu,
 * or .edu.<country> and .ac.<country> (UK, Australia, India and the rest).
 */
export function isSchoolEmail(email: string | null | undefined): boolean {
  const domain = email?.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return /(^|\.)edu$/.test(domain) || /(^|\.)(edu|ac)\.[a-z]{2}$/.test(domain);
}

/**
 * Which price an organization pays for `plan`: student when its owner's
 * address is a school's and it has no more members than the plan's student
 * cap, standard otherwise. Student prices are for student organizations,
 * not businesses (the terms say so); a team that leaves school moves to
 * the standard price on the same plan.
 */
export function studentPricing(
  plan: ClubPlanId,
  owner: { email: string | null | undefined },
  members: number,
): PriceTrack {
  return isSchoolEmail(owner.email) && members <= TEAM_PRICES[plan].studentMemberCap
    ? "student"
    : "standard";
}

/** What a team plan costs, ready to print: the total, what it's for, and how it's worked out. */
export interface TeamQuote {
  track: PriceTrack;
  /** The amount billed each time, in dollars. */
  total: number;
  /** "a year", "a semester". */
  per: string;
  /** "40 members × $8 a month, billed yearly", "Flat, up to 100 members". */
  basis: string;
}

/**
 * The price of `plan` for `members` members: standard is per member a
 * month, billed yearly; student is flat per academic year or semester.
 */
export function teamQuote(
  plan: ClubPlanId,
  track: PriceTrack,
  members: number,
  term: StudentTerm = "year",
): TeamQuote {
  const prices = TEAM_PRICES[plan];
  if (track === "student") {
    return {
      track,
      total: term === "year" ? prices.studentPerYear : prices.studentPerSemester,
      per: term === "year" ? "a year" : "a semester",
      basis: `Flat, up to ${prices.studentMemberCap} members. Members never pay.`,
    };
  }
  const seats = Math.max(1, members);
  return {
    track,
    total: prices.perMemberPerMonth * 12 * seats,
    per: "a year",
    basis: `${seats} ${seats === 1 ? "member" : "members"} × ${dollars(prices.perMemberPerMonth)} a month, billed yearly`,
  };
}

/** "$4", "$1,200": whole dollars, as the pricing cards print them. */
export function dollars(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
