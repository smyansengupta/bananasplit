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
import {
  clubPlanIdOf,
  dollars,
  PERSONAL_PLANS,
  type PriceTrack,
  studentPricing,
  TEAM_PRICES,
  teamQuote,
} from "@/lib/billing/plans";
import { spaceLimits, spaceStatus, trialDaysLeft } from "@/lib/billing/space";
import { formatStorage } from "@/lib/billing/storage";
import { StorageMeter } from "@/components/billing/storage-meter";
import { connectorsConfig } from "@/server/connectors/config";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
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

/** Who the organization is, for its price: the owner's address and how many members it has. */
interface PriceContext {
  ownerEmail: string | null;
  members: number;
}

/** A paid team plan's price line: standard per member a month, or a student organization's flat price. */
function teamPrice(plan: "CLUB" | "SOCIETY", price: PriceContext) {
  const id = clubPlanIdOf(plan)!;
  const track: PriceTrack = studentPricing(id, { email: price.ownerEmail }, price.members);
  const prices = TEAM_PRICES[id];
  if (track === "student") {
    return {
      price: dollars(prices.studentPerYear),
      per: `a year, or ${dollars(prices.studentPerSemester)} a semester`,
      note: `Student price: flat, up to ${prices.studentMemberCap} members.`,
    };
  }
  const yearly = teamQuote(id, "standard", price.members);
  return {
    price: dollars(prices.perMemberPerMonth),
    per: "per member a month, billed yearly",
    note: `${dollars(yearly.total)} a year for ${price.members} ${price.members === 1 ? "member" : "members"}.`,
  };
}

/** What sets a card apart from the one before it: its features, then its limits. */
function card(plan: PricedPlan, previous: PricedPlan | null, price: PriceContext): PlanCard {
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
    case "TEAM_FREE":
      return {
        ...base,
        price: "$0",
        per: "forever, unlimited members",
        who: "For any team getting started.",
      };
    case "CLUB":
      return {
        ...base,
        ...teamPrice("CLUB", price),
        who: "For growing teams that run their money and people here.",
      };
    case "SOCIETY":
      return {
        ...base,
        ...teamPrice("SOCIETY", price),
        who: "For teams that want every feature, AI included.",
      };
  }
}

/**
 * Settings › Plan and storage › Plan (docs/features/personal-and-clubs.md,
 * the Bananasplit business model). A Personal space chooses Personal Free
 * or Personal Plus; an organization Free, Team or Team Advanced, during its
 * trial or after it (an ended trial is already Free). Team prices are the
 * standard ones, or a student organization's flat ones when its owner has
 * a school address (studentPricing). The OWNER chooses (also enforced in
 * the database: app.organization_guard and app.organization_space_guard);
 * admins can look. Billing isn't connected yet, so a choice takes effect at
 * once; when it is, paid plans go through checkout instead (changeOrgPlan
 * is the seam).
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
  const [usedBytes, storageParts, price] = await Promise.all([
    readStorageUsed(organization.id),
    storageBreakdown(organization.id),
    personal
      ? Promise.resolve({ ownerEmail: null, members: 1 })
      : withOrgTx(organization.id, async ({ db }): Promise<PriceContext> => {
          const [owner, members] = await Promise.all([
            db.membership.findFirst({
              where: { organizationId: organization.id, role: "OWNER" },
              orderBy: { joinedAt: "asc" },
              select: { user: { select: { email: true } } },
            }),
            db.membership.count({ where: { organizationId: organization.id } }),
          ]);
          return { ownerEmail: owner?.user.email ?? null, members: Math.max(1, members) };
        }),
  ]);
  const choices = planChoicesFor(organization.kind);
  const cards = choices.map((plan, i) => card(plan, i === 0 ? null : choices[i - 1]!, price));
  const current = spaceStatus(organization) === "free" ? "TEAM_FREE" : organization.plan;
  const effective = PLAN_NAMES[current];

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
      . When it ends {organization.name} moves to Free, unless{" "}
      {canSwitch ? "you choose" : "the owner chooses"} Team or Team Advanced.
    </>
  ) : status === "free" && organization.plan === "TRIAL" ? (
    <>
      The free trial has ended, so {organization.name} is on{" "}
      <strong className="text-foreground">Free</strong>. Nothing was deleted: what Team and Team
      Advanced add is locked, and comes back when {canSwitch ? "you choose" : "the owner chooses"}{" "}
      one.
    </>
  ) : (
    <>
      {organization.name} is on the <strong className="text-foreground">{effective}</strong> plan.
      Switching never deletes anything: what a plan leaves out is locked, and comes back when you
      switch again.
    </>
  );

  return (
    <div className="max-w-4xl space-y-7.5">
      <PlanHeader orgSlug={organization.slug} title="Plan and storage" description={summary} />
      <StorageMeter
        usedBytes={usedBytes}
        limitBytes={spaceLimits(organization).storageBytes}
        maxFileBytes={spaceLimits(organization).maxFileBytes}
        planName={effective}
        parts={storageParts}
        personal={personal}
        href={`/app/${organization.slug}/settings/plan/storage`}
      />
      <PlanCards
        orgId={organization.id}
        kind={organization.kind}
        current={current}
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
