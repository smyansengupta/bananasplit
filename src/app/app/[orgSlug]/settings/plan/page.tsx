import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";

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
import {
  effectivePlan,
  planPickedForAfterTrial,
  spaceLimits,
  spaceStatus,
  trialDaysLeft,
} from "@/lib/billing/space";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { storageNearlyFull } from "@/lib/ambient/forms";
import { formatStorage } from "@/lib/billing/storage";
import { StorageMeter } from "@/components/billing/storage-meter";
import { connectorsConfig } from "@/server/connectors/config";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { canManageStorage, readStorageUsed } from "@/server/storage/quota";
import { largestFiles, storageBreakdown } from "@/server/storage/usage";

import { SettingsNoAccess } from "../settings-no-access";
import { PlanCards, type PlanCard } from "./plan-cards";
import { EmptyTrashButton } from "./storage/empty-trash-button";

export const metadata: Metadata = { title: "Plan" };

function historyLabel(days: number): string {
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return `${days} days`;
}

/** What Personal Plus's extras are called for one person (Google Calendar is its data connection). */
const PERSONAL_LABELS: Partial<Record<PlanFeature, string>> = {
  integrations: "Integrations, Google Calendar included",
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
  if (limits.dataConnections > 0) {
    features.push(
      `Up to ${limits.dataConnections} ${plan === "PERSONAL_PLUS" ? "integrations" : "data connections"}`,
    );
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
      return { ...base, price: "$0", per: "forever" };
    case "PERSONAL_PLUS":
      return {
        ...base,
        price: dollars(PERSONAL_PLANS.plus.perMonth),
        per: `a month, or ${dollars(PERSONAL_PLANS.plus.perYear)} a year`,
      };
    case "TEAM_FREE":
      return {
        ...base,
        price: "$0",
        per: "forever, up to 10 members",
      };
    case "CLUB":
      return {
        ...base,
        ...teamPrice("CLUB", price),
      };
    case "SOCIETY":
      return {
        ...base,
        ...teamPrice("SOCIETY", price),
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
    return <SettingsNoAccess title="Plan" who="owners and admins" />;
  }
  const status = spaceStatus(organization);
  const days = trialDaysLeft(organization);
  const canSwitch = can({ role }, "org.plan.write");
  const showFiles = canManageStorage(role);
  const [usedBytes, storageParts, biggest, price] = await Promise.all([
    readStorageUsed(organization.id),
    storageBreakdown(organization.id),
    showFiles
      ? withOrgTx(organization.id, ({ db }) => largestFiles(db, organization.id))
      : Promise.resolve([]),
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
  const pickedForAfter = planPickedForAfterTrial(organization);
  const current =
    pickedForAfter ??
    (organization.plan === "TRIAL" ? effectivePlan(organization) : organization.plan);
  const effective = PLAN_NAMES[effectivePlan(organization)];

  // The one line about where the space stands. It's in the page body, not
  // the header's description, so phones see it too (that line is hidden
  // there).
  const left = days !== null ? `${days} ${days === 1 ? "day" : "days"} left` : "";
  const summary =
    personal && days !== null && days > 0 && organization.plan === "FREE" ? (
      <>
        Free trial of Personal Plus: <strong className="text-foreground">{left}</strong>. Then
        Personal Free, unless you choose Plus.
      </>
    ) : personal ? (
      <>
        On <strong className="text-foreground">{PLAN_NAMES[organization.plan]}</strong>.
      </>
    ) : status === "trial" && days !== null ? (
      <>
        Free trial of Team Advanced: <strong className="text-foreground">{left}</strong>. Then{" "}
        <strong className="text-foreground">
          {pickedForAfter ? PLAN_NAMES[pickedForAfter] : "Free"}
        </strong>
        {pickedForAfter ? "." : ", unless a plan is picked."}
      </>
    ) : status === "free" && organization.plan === "TRIAL" ? (
      <>
        Trial ended: on <strong className="text-foreground">Free</strong>. Nothing was deleted.
      </>
    ) : (
      <>
        On <strong className="text-foreground">{effective}</strong>.
      </>
    );
  const base = `/app/${organization.slug}`;
  // Free up space: 90% used, for those who can clear files (src/lib/ambient/forms.ts).
  const full = showFiles
    ? storageNearlyFull(usedBytes, spaceLimits(organization).storageBytes)
    : null;

  return (
    <div className="max-w-4xl space-y-7.5">
      <PageHeader title="Plan" />
      <p className="text-muted-foreground -mt-3 text-[15px]">
        {summary}
        {!canSwitch && " Only the owner can choose a plan."}
      </p>
      {full !== null && (
        <AmbientActions
          why
          className="-mt-3 items-start"
          actions={[
            {
              key: "space",
              label: "Free up space",
              reason: `Storage is ${Math.min(100, Math.round(full * 100))}% full`,
              tone: "spark",
              // The largest files and the trash, just below.
              href: "#largest-heading",
            },
          ]}
        />
      )}
      <PlanCards
        orgId={organization.id}
        kind={organization.kind}
        current={current}
        cards={cards}
        canSwitch={canSwitch}
        usedBytes={usedBytes}
      />
      <section id="storage" aria-labelledby="storage-heading" className="scroll-mt-24 space-y-4.5">
        <h2 id="storage-heading" className="heading text-[17px]">
          Storage
        </h2>
        <StorageMeter
          usedBytes={usedBytes}
          limitBytes={spaceLimits(organization).storageBytes}
          maxFileBytes={spaceLimits(organization).maxFileBytes}
          planName={effective}
          parts={storageParts}
          personal={personal}
        />
        {showFiles && (
          <div className="grid gap-4.5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <section
              aria-labelledby="largest-heading"
              className="bg-card edge rounded-card space-y-3 p-6 max-sm:p-4.5"
            >
              <h3 id="largest-heading" className="heading text-[15px]">
                Largest files
              </h3>
              {biggest.length === 0 ? (
                <p className="text-muted-foreground text-sm">No files yet.</p>
              ) : (
                <ul className="divide-border/60 divide-y">
                  {biggest.map((f) => (
                    <li key={f.id} className="flex items-start gap-3 py-2.5 text-sm">
                      <Link
                        href={`${base}/notes/files/${f.id}`}
                        className="min-w-0 flex-1 font-medium break-words hover:underline"
                      >
                        {f.name}
                      </Link>
                      <span className="figure text-muted-foreground shrink-0">
                        {formatStorage(f.sizeBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section
              aria-labelledby="trash-heading"
              className="bg-card edge rounded-card flex flex-col items-start gap-3 p-6 max-sm:p-4.5"
            >
              <h3 id="trash-heading" className="heading text-[15px]">
                Trash
              </h3>
              <p className="text-muted-foreground text-sm">
                {storageParts.trashItems} {storageParts.trashItems === 1 ? "item" : "items"},{" "}
                {formatStorage(storageParts.trashBytes)}. Counts until emptied.
              </p>
              <EmptyTrashButton
                orgId={organization.id}
                items={storageParts.trashItems}
                size={formatStorage(storageParts.trashBytes)}
              />
            </section>
          </div>
        )}
      </section>
      <p className="text-muted-foreground text-xs">
        {!personal && "Members who join never pay. "}Billing isn&apos;t live: nothing is charged.
      </p>
    </div>
  );
}
