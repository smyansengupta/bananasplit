import Link from "next/link";
import { cache, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { Handshake } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveCrmTabs, type ResolvedCrmTab } from "@/lib/crm/nav";
import { planGate } from "@/server/billing/plan-gate";
import { crmAccessOf, readCrmSettings, type CrmAccess } from "@/server/crm/access";
import { rolePositions, type RoleOwner } from "@/server/crm/owners";
import { listPipelines, type PipelineView } from "@/server/crm/pipelines";
import { getOrgContextBySlug, withOrgTx, type OrgContextBySlug } from "@/server/db/context";
import { buildViewerChart, getChartForPage } from "@/server/tasks/assignment-policy";

/**
 * Every CRM page starts here: the plan (Team Advanced), the add-on (added
 * on Integrations and apps) and the one-step setup, then the pipelines for
 * the tabs. `gate` is what to show instead of the page when one of those
 * isn't there yet.
 *
 * Deduped per request (React cache()), so a page and the card open over it
 * share one shell. The space and its add-ons come from the org context the
 * layout already read; the org chart's positions (a cached read) load beside
 * the CRM's settings and pipelines. Members load only where a page or card
 * asks for them (crmMembers).
 */

export interface CrmShell {
  org: OrgContextBySlug["organization"];
  user: OrgContextBySlug["user"];
  role: OrgContextBySlug["role"];
  access: CrmAccess;
  pipelines: PipelineView[];
  tabs: ResolvedCrmTab[];
  roles: Map<string, RoleOwner>;
}

export interface CrmMember {
  id: string;
  name: string;
}

/**
 * The organization's members by name (owner pickers, "Owner:" lines, who
 * wrote a note): once per request, and only where something shows them.
 */
export const crmMembers = cache(async (organizationId: string): Promise<CrmMember[]> => {
  const rows = await withOrgTx(organizationId, ({ db }) =>
    db.membership.findMany({
      where: { organizationId },
      select: { userId: true, user: { select: { name: true } } },
      take: 2000,
    }),
  );
  return rows
    .map((m) => ({ id: m.userId, name: m.user.name ?? "Member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/** crmMembers as id to name. */
/**
 * The viewer's team, as Tasks' My team reads it: the people under them on
 * the published org chart (not the viewer). Empty without reports, and
 * then My team isn't offered. Once per request.
 */
export const crmTeam = cache(async (organizationId: string, userId: string): Promise<string[]> => {
  const positions = await getChartForPage(organizationId).catch(() => null);
  return buildViewerChart(positions, userId).subtree.filter((id) => id !== userId);
});

export async function crmMemberNames(organizationId: string): Promise<Map<string, string>> {
  return new Map((await crmMembers(organizationId)).map((m) => [m.id, m.name]));
}

type ShellResult = { gate: ReactNode; shell: null } | { gate: null; shell: CrmShell };

export function crmShell(orgSlug: string, options: { setup?: boolean } = {}): Promise<ShellResult> {
  return loadShell(orgSlug, Boolean(options.setup));
}

/** The shell with the members on it: CRM settings, where most sections list or pick members. */
export interface CrmSettingsShell extends CrmShell {
  members: CrmMember[];
}

export async function crmSettingsShell(
  orgSlug: string,
): Promise<{ gate: ReactNode; shell: null } | { gate: null; shell: CrmSettingsShell }> {
  const loaded = await crmShell(orgSlug);
  if (!loaded.shell) return loaded;
  return { gate: null, shell: { ...loaded.shell, members: await crmMembers(loaded.shell.org.id) } };
}

const loadShell = cache(async (orgSlug: string, setup: boolean): Promise<ShellResult> => {
  const locked = await planGate(orgSlug, "crm", { title: "CRM" });
  if (locked) return { gate: locked, shell: null };
  const { organization: org, user, role, settings: orgSettings } = await getOrgContextBySlug(orgSlug);
  const base = `/app/${orgSlug}`;
  const [loaded, roles] = await Promise.all([
    withOrgTx(org.id, async ({ db }) => {
      const settings = await readCrmSettings(db, org.id);
      const access = crmAccessOf({ role, userId: user.id }, org, orgSettings?.addOns, settings);
      const pipelines = access.added && settings ? await listPipelines(db, org.id) : [];
      return { access, pipelines };
    }),
    rolePositions(org.id),
  ]);
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
  if (!access.settings && !setup) {
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
  return {
    gate: null,
    shell: {
      org,
      user,
      role,
      access,
      pipelines: loaded.pipelines,
      roles,
      tabs: resolveCrmTabs(orgSlug, loaded.pipelines, { manager: access.manager }),
    },
  };
});
