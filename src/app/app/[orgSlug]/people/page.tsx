import { UserPlus } from "@/components/icons";

import { PageHeader } from "@/components/page-header";
import { parseDirectoryQuery } from "@/components/profile/directory-query";
import { PeopleDirectory } from "@/components/profile/people-directory";
import { Button } from "@/components/ui/button";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { getPersonSheet, loadDirectory } from "@/server/profiles/directory";
import { planGate } from "@/server/billing/plan-gate";

import { InviteDialog } from "../settings/members/invite-dialog";
import { loadOrgChartSection } from "../org-chart/chart-section";

/**
 * People (Moonstone 12.1): every current member of this org with their
 * team from the org chart, who's online and whether they're free now,
 * searched as you type and filtered on the client, and the profile sheet
 * over the list (?person=). Grid, List and Org chart are its three views
 * (?view=chart is the published chart; /org-chart redirects here). The
 * roster (roles, titles, invites) is Admin > Members. Invite people opens
 * right here. Members only (getOrgContextBySlug answers 404 to anyone else).
 */
export default async function PeoplePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/people">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const raw = await searchParams;
  const query = parseDirectoryQuery(raw);
  const { organization, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const orgId = organization.id;
  const canInvite = can({ role }, "members.invite");

  const [directory, joinCode, chart] = await Promise.all([
    loadDirectory(orgId, organization.timezone),
    canInvite
      ? withOrgTx(orgId, ({ db }) => getOrCreateJoinCode(db, orgId, user.id))
      : Promise.resolve(null),
    loadOrgChartSection({
      orgSlug,
      organization,
      role,
      selectedKey: typeof raw.position === "string" ? raw.position : null,
    }),
  ]);
  const initialSheet = query.person
    ? await getPersonSheet(
        orgId,
        query.person,
        { id: user.id, role, membersSeeEmails: settings?.showMemberEmailsToMembers === true },
        organization.timezone,
      )
    : null;
  const initial = initialSheet || !query.person ? query : { ...query, person: null };

  const { total, teams, people } = directory;
  const link = joinCode
    ? {
        code: joinCode.code,
        enabled: joinCode.enabled,
        url: absoluteAppUrl(`/join/${joinCode.code}`),
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "people")}
        actions={
          canInvite && (
            <InviteDialog
              orgId={orgId}
              orgSlug={orgSlug}
              link={link}
              defaultOpen={raw.invite === "1"}
              trigger={
                <Button variant="create">
                  <UserPlus aria-hidden="true" />
                  Invite
                </Button>
              }
            />
          )
        }
      />
      <PeopleDirectory
        orgId={orgId}
        orgSlug={orgSlug}
        orgTimezone={organization.timezone}
        viewerId={user.id}
        people={people}
        teams={teams}
        total={total}
        initial={initial}
        initialSheet={initialSheet}
        chart={chart}
      />
    </div>
  );
}
