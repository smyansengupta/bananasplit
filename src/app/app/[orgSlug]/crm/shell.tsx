import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { Handshake } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveCrmTabs, type ResolvedCrmTab } from "@/lib/crm/nav";
import { planGate } from "@/server/billing/plan-gate";
import { crmAccess, type CrmAccess } from "@/server/crm/access";
import { rolePositions, type RoleOwner } from "@/server/crm/owners";
import { listPipelines, type PipelineView } from "@/server/crm/pipelines";
import { getOrgContextBySlug, withOrgTx, type OrgContextBySlug } from "@/server/db/context";

/**
 * Every CRM page starts here: the plan (Team Advanced), the add-on (added
 * on Integrations and apps) and the one-step setup, then the pipelines for
 * the tabs. `gate` is what to show instead of the page when one of those
 * isn't there yet.
 */

export interface CrmShell {
  org: OrgContextBySlug["organization"];
  user: OrgContextBySlug["user"];
  role: OrgContextBySlug["role"];
  access: CrmAccess;
  pipelines: PipelineView[];
  tabs: ResolvedCrmTab[];
  roles: Map<string, RoleOwner>;
  members: { id: string; name: string }[];
}

export async function crmShell(
  orgSlug: string,
  options: { setup?: boolean } = {},
): Promise<{ gate: ReactNode; shell: null } | { gate: null; shell: CrmShell }> {
  const locked = await planGate(orgSlug, "crm", { title: "CRM" });
  if (locked) return { gate: locked, shell: null };
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const base = `/app/${orgSlug}`;
  const loaded = await withOrgTx(org.id, async (ctx) => {
    const access = await crmAccess(ctx);
    const pipelines = access.settings ? await listPipelines(ctx.db, org.id) : [];
    const members = await ctx.db.membership.findMany({
      where: { organizationId: org.id },
      select: { userId: true, user: { select: { name: true } } },
      take: 2000,
    });
    return {
      access,
      pipelines,
      members: members
        .map((m) => ({ id: m.userId, name: m.user.name ?? "Member" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  const { access } = loaded;
  if (!access.added) {
    return {
      gate: (
        <Card>
          <EmptyState
            icon={Handshake}
            title="The CRM isn't added yet"
            description={
              access.admin
                ? "Add it on Integrations and apps. It takes one click."
                : "Ask an owner or admin to add it on Integrations and apps."
            }
            action={
              access.admin ? (
                <Button asChild>
                  <Link href={`${base}/integrations/crm`}>See the CRM</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ),
      shell: null,
    };
  }
  if (!access.settings && !options.setup) {
    return {
      gate: (
        <Card>
          <EmptyState
            icon={Handshake}
            title="Set up the CRM"
            description={
              access.admin
                ? "Say what you mostly reach out to, and it makes the pipelines and lists for you."
                : "An owner or admin sets it up first. It takes a minute."
            }
            action={
              access.admin ? (
                <Button asChild>
                  <Link href={`${base}/crm/setup`}>Set it up</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ),
      shell: null,
    };
  }
  const roles = await rolePositions(org.id);
  return {
    gate: null,
    shell: {
      org,
      user,
      role,
      access,
      pipelines: loaded.pipelines,
      roles,
      members: loaded.members,
      tabs: resolveCrmTabs(orgSlug, loaded.pipelines, { manager: access.manager }),
    },
  };
}
