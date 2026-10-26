import { UserPlus } from "@/components/icons";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { parseDirectoryQuery } from "@/components/profile/directory-query";
import { PeopleDirectory } from "@/components/profile/people-directory";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug } from "@/server/db/context";
import { getPersonSheet, loadDirectory } from "@/server/profiles/directory";
import { planGate } from "@/server/billing/plan-gate";

import { PeopleTabs } from "./people-tabs";

/**
 * The people directory (Moonstone 12.1): every current member of this org
 * with their team from the org chart and whether they're free now, searched
 * as you type and filtered on the client, and the profile sheet beside the
 * list (?person=). The first of People's two tabs (the org chart is the
 * other). Members only (getOrgContextBySlug answers 404 to anyone else).
 */
export default async function PeoplePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/people">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const query = parseDirectoryQuery(await searchParams);
  const { organization, user, role, settings } = await getOrgContextBySlug(orgSlug);

  const directory = await loadDirectory(organization.id, organization.timezone);
  const initialSheet = query.person
    ? await getPersonSheet(
        organization.id,
        query.person,
        { id: user.id, role, membersSeeEmails: settings?.showMemberEmailsToMembers === true },
        organization.timezone,
      )
    : null;
  const initial = initialSheet || !query.person ? query : { ...query, person: null };

  const { total, teams, people } = directory;
  const free = people.filter((p) => p.freeNow).length;
  const summary = [
    `${total} ${total === 1 ? "member" : "members"}`,
    teams.length > 0 && `${teams.length} ${teams.length === 1 ? "team" : "teams"}`,
    free > 0 && `${free} free now`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "people")}
        description={summary}
        actions={
          can({ role }, "members.invite") && (
            <Button asChild variant="create">
              <Link href={`/app/${orgSlug}/settings/members`}>
                <UserPlus aria-hidden="true" />
                Invite people
              </Link>
            </Button>
          )
        }
        tabs={<PeopleTabs orgSlug={orgSlug} />}
      />
      <PeopleDirectory
        orgId={organization.id}
        orgSlug={orgSlug}
        orgTimezone={organization.timezone}
        viewerId={user.id}
        people={people}
        teams={teams}
        total={total}
        initial={initial}
        initialSheet={initialSheet}
      />
    </div>
  );
}
