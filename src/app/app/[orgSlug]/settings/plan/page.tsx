import type { Metadata } from "next";

import { can } from "@/lib/auth/permissions";
import {
  FEATURE_LABELS,
  featuresOf,
  PLAN_LIMITS,
  PLAN_NAMES,
  planChoicesFor,
  type PlanFeature,
  type PricedPlan,
} from "@/lib/billing/features";
import { CLUB_PLANS, dollars, PERSONAL_PLANS } from "@/lib/billing/plans";
import { spaceLimits, spaceStatus, trialDaysLeft } from "@/lib/billing/space";
import { formatStorage } from "@/lib/billing/storage";
import { StorageMeter } from "@/components/billing/storage-meter";
import { connectorsConfig } from "@/server/connectors/config";
import { getOrgContextBySlug } from "@/server/db/context";
import { readStorageUsed } from "@/server/storage/quota";
import { storageBreakdown } from "@/server/storage/usage";

import { SettingsNoAccess } from "../settings-no-access";
import { PlanCards, type PlanCard } from "./plan-cards";
import { PlanHeader } from "./plan-header";

export const metadata: Metadata = { title: "Plan and storage" };

function historyLabel(days: number): string {
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return `${days} days`;
}

/** What Personal Plus's extras are called for one person (Google Calendar is its data connection). */
const PERSONAL_LABELS: Partial<Record<PlanFeature, string>> = {
  integrations: "Calendar sync",
  ai: "AI imports",
};

/** What sets a card apart from the one before it: its features, then its limits. */
function card(plan: PricedPlan, previous: PricedPlan | null): PlanCard {
  const before = new Set(previous ? featuresOf(previous) : []);
  // AI connectors are listed only once the deployment turns them on.
  const offered = (f: PlanFeature) => f !== "connectors" || connectorsConfig() !== null;
  const features = featuresOf(plan)
    .filter((f) => !before.has(f) && offered(f))
    .map((f) => (plan === "PERSONAL_PLUS" ? PERSONAL_LABELS[f] : undefined) ?? FEATURE_LABELS[f]);
  const limits = PLAN_LIMITS[plan];
  if (limits.dataConnections > 0 && plan !== "PERSONAL_PLUS") {
    features.push(`Up to ${limits.dataConnections} data connections`);
  }
  const base = {
    plan,
    name: PLAN_NAMES[plan],
    intro: previous ? `Everything in ${PLAN_NAMES[previous]}, plus` : "Includes",
    features,
    storageBytes: limits.storageBytes,
    limits: [
      { label: "Storage", value: formatStorage(limits.storageBytes) },
      { label: "Largest file", value: formatStorage(limits.maxFileBytes) },
      { label: "Note history", value: historyLabel(limits.noteHistoryDays) },
    ],
  };
  switch (plan) {
    case "FREE":
      return { ...base, price: "$0", per: "forever", who: "For one person: your own space." };
    case "PERSONAL_PLUS":
      return {
        ...base,
        price: dollars(PERSONAL_PLANS.plus.perMonth),
        per: `a month, or ${dollars(PERSONAL_PLANS.plus.perYear)} a year`,
        who: "For one person who wants more room.",
      };
    case "CLUB":
      return {
        ...base,
        price: dollars(CLUB_PLANS.club.perMemberPerSemester),
        per: "per member / semester",
        who: "For active clubs with an officer team.",
      };
    case "SOCIETY":
      return {
        ...base,
        price: dollars(CLUB_PLANS.society.perMemberPerSemester),
        per: "per member / semester",
        who: "For big clubs and societies that want every feature.",
      };
  }
}

/**
 * Settings › Plan and storage › Plan (docs/features/personal-and-clubs.md,
 * redesign guide 11.1). A Personal space chooses Personal Free or Personal
 * Plus; a club, during its trial or after it, Team or Team Advanced. The
 * OWNER chooses (also enforced in the database: app.organization_guard and
 * app.organization_space_guard); admins can look. A paused club (trial
 * over, no plan yet) is sent here by its banner: choosing a plan is the one
 * change it accepts. Billing isn't connected yet, so a choice takes effect
 * at once; when it is, it goes through checkout instead (changeOrgPlan is
 * the seam).
 */
export default async function PlanSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/plan">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  const personal = organization.kind === "PERSONAL";
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="Plan and storage" who="owners and admins" />;
  }
  const status = spaceStatus(organization);
  const days = trialDaysLeft(organization);
  const canSwitch = can({ role }, "org.plan.write");
  const [usedBytes, storageParts] = await Promise.all([
    readStorageUsed(organization.id),
    storageBreakdown(organization.id),
  ]);
  const [first, second] = planChoicesFor(organization.kind);
  const cards = [card(first!, null), card(second!, first!)];

  const summary = personal ? (
    <>
      You&apos;re on <strong className="text-foreground">{PLAN_NAMES[organization.plan]}</strong>.
      Switching never deletes anything: what a plan leaves out is locked, and comes back when you
      switch again.
    </>
  ) : status === "trial" && days !== null ? (
    <>
      {organization.name} is on its free trial, with everything in Team Advanced:{" "}
      <strong className="text-foreground">
        {days} {days === 1 ? "day" : "days"} left
      </strong>
      . Choose Team or Team Advanced before it ends to keep going without a pause.
    </>
  ) : status === "paused" ? (
    <>
      The free trial has ended, so {organization.name} is paused: everything is still here and
      everyone can read it, but nothing can be added or changed until{" "}
      {canSwitch ? "you choose" : "the owner chooses"} a plan.
    </>
  ) : (
    <>
      {organization.name} is on the{" "}
      <strong className="text-foreground">{PLAN_NAMES[organization.plan]}</strong> plan. Switching
      never deletes anything: what a plan leaves out is locked, and comes back when you switch
      again.
    </>
  );

  return (
    <div className="max-w-4xl space-y-7.5">
      <PlanHeader
        orgSlug={organization.slug}
        title={status === "paused" ? "Choose a plan" : "Plan and storage"}
        description={summary}
      />
      <StorageMeter
        usedBytes={usedBytes}
        limitBytes={spaceLimits(organization).storageBytes}
        maxFileBytes={spaceLimits(organization).maxFileBytes}
        planName={PLAN_NAMES[organization.plan]}
        parts={storageParts}
        personal={personal}
        href={`/app/${organization.slug}/settings/plan/storage`}
      />
      <PlanCards
        orgId={organization.id}
        kind={organization.kind}
        current={organization.plan}
        cards={cards}
        canSwitch={canSwitch}
        usedBytes={usedBytes}
      />
      <div className="text-muted-foreground space-y-1 text-xs">
        {!personal && <p>Members who join never pay.</p>}
        <p>
          Billing isn&apos;t connected yet, so a choice takes effect right away and nothing is
          charged.
        </p>
      </div>
    </div>
  );
}
