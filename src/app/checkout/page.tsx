import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireUser } from "@/lib/auth/session";
import { isClubPlanId, isSchoolEmail } from "@/lib/billing/plans";
import {
  formatSemesterDate,
  nextAcademicYearStart,
  nextSemesterStart,
} from "@/lib/billing/semester";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOnboardingProfile } from "@/server/onboarding/profile";

import { checkoutAvailable } from "./availability";
import { CheckoutForm, type CheckoutPlan } from "./checkout-form";

export const metadata: Metadata = { title: "Subscribe · Bananasplit" };

/** The seat count shown when the user has no organization yet (the design's sample). */
const DEFAULT_MEMBERS = 40;

/** The renewal lines' dates, read at request time (outside the render body). */
function renewal() {
  const now = new Date();
  const inAYear = new Date(now);
  inAYear.setUTCFullYear(now.getUTCFullYear() + 1);
  return {
    renews: {
      standard: formatSemesterDate(inAYear),
      year: formatSemesterDate(nextAcademicYearStart(now)),
      semester: formatSemesterDate(nextSemesterStart(now).date),
    },
  };
}

/**
 * Checkout (the design's "04 · Checkout (Stripe)"), in Moonstone: subscribe an
 * organization to Team (?plan=club) or Team Advanced (?plan=society, the
 * default), or yourself to Personal Plus (?plan=plus). The query values are
 * the old plan names, kept so existing links work. ?org=<slug> picks the
 * organization when the user belongs to it, else their first; the seats
 * start at its member count. A subscriber with a school address can take
 * the student price (src/lib/billing/plans.ts: studentPricing). Billing
 * isn't connected yet: the form never submits (see CheckoutForm).
 */
export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  // The card fields are a visual stand-in for Stripe's Payment Element. On
  // the production deployment the page doesn't exist until billing is
  // connected, so nobody types a real card number into our own inputs.
  if (!checkoutAvailable()) notFound();
  const user = await requireUser();
  const params = await searchParams;
  const plan: CheckoutPlan =
    params.plan === "plus" ? "plus" : isClubPlanId(params.plan) ? params.plan : "society";
  const orgParam = typeof params.org === "string" ? params.org : null;

  const schoolEmail = isSchoolEmail(user.email);

  // Personal Plus is for the person, not an organization: no seats to count.
  if (plan === "plus") {
    return (
      <CheckoutForm
        plan={plan}
        clubName=""
        initialMembers={1}
        email={user.email}
        schoolEmail={schoolEmail}
        backHref="/pricing"
        backLabel="Bananasplit, back to pricing"
        {...renewal()}
      />
    );
  }

  // Only the user's own orgs: a slug they don't belong to falls back to
  // their first organization rather than a 404.
  const memberships = (await getOnboardingProfile(user.id))?.memberships ?? [];
  const club = memberships.find((m) => m.slug === orgParam) ?? memberships[0] ?? null;

  let members = DEFAULT_MEMBERS;
  if (club) {
    const { organization } = await getOrgContextBySlug(club.slug);
    const count = await withOrgTx(organization.id, ({ db }) =>
      db.membership.count({ where: { organizationId: organization.id } }),
    ).catch(handleAuthErrorInPage);
    members = Math.max(1, count);
  }

  return (
    <CheckoutForm
      plan={plan}
      clubName={club?.name ?? "your organization"}
      initialMembers={members}
      email={user.email}
      schoolEmail={schoolEmail}
      backHref={club ? `/app/${club.slug}/settings/plan` : "/pricing"}
      backLabel={club ? "Bananasplit, back to your plan" : "Bananasplit, back to pricing"}
      {...renewal()}
    />
  );
}
