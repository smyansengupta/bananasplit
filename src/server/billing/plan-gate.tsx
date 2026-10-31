import "server-only";

import type { ReactNode } from "react";

import { PlanLocked } from "@/components/billing/plan-locked";
import { can } from "@/lib/auth/permissions";
import type { PlanFeature } from "@/lib/billing/features";
import { spaceIncludes } from "@/lib/billing/space";
import { getOrgContextBySlug } from "@/server/db/context";

/**
 * A page's feature check, on the server, before it loads anything:
 *
 *   const locked = await planGate(orgSlug, "finance");
 *   if (locked) return locked;
 *
 * null when the space includes `feature` (spaceIncludes: Personal, a trial,
 * or the club's plan); otherwise the locked screen to return instead of the
 * page. getOrgContextBySlug is cached per request, so this costs nothing
 * extra.
 */
export async function planGate(
  orgSlug: string,
  feature: PlanFeature,
  options: { title?: string } = {},
): Promise<ReactNode | null> {
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (spaceIncludes(organization, feature)) return null;
  return (
    <PlanLocked
      feature={feature}
      orgId={organization.id}
      orgSlug={organization.slug}
      kind={organization.kind}
      plan={organization.plan}
      canSeePlans={can({ role }, "settings.view")}
      title={options.title}
    />
  );
}
