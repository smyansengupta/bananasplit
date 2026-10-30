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
import { PeopleTabs } from "./people-tabs";

/** Request-time check, outside the render body (react-hooks/purity). */
function isPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}

/**
 * The people directory (Moonstone 12.1): every current member of this org
 * with their team from the org chart and whether they're free now, searched
 * as you type and filtered on the client, and the profile sheet over the
 * list (?person=). Grid, List and Table, like Tasks' layouts; Table is the
 * roster: emails (as far as the viewer may see them) and, for owners and
 * admins, roles and titles edited in place, invites waiting as rows, and
 * Invite people opening right here. The first of People's two tabs (the org
 * chart is the other). Members only (getOrgContextBySlug answers 404 to
 * anyone else).
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
  const orgId = organization.id;
  const canInvite = can({ role }, "members.invite");
  const canManage = can({ role }, "members.changeRole");
  const showEmails =
    can({ role }, "members.viewEmails") || settings?.showMemberEmailsToMembers === true;

  const [directory, extras] = await Promise.all([
    loadDirectory(orgId, organization.timezone),
    withOrgTx(orgId, async ({ db }) => {
      const emails = showEmails
        ? await db.membership.findMany({
            where: { organizationId: orgId },
            select: { userId: true, user: { select: { email: true } } },
          })
        : [];
      const invites = canInvite
        ? await db.invitation.findMany({
            where: { organizationId: orgId, acceptedAt: null },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: { id: true, email: true, role: true, expiresAt: true },
          })
        : [];
      const joinCode = canInvite ? await getOrCreateJoinCode(db, orgId, user.id) : null;
      return { emails, invites, joinCode };
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
  const emails = Object.fromEntries(
    extras.emails.filter((m) => m.user.email).map((m) => [m.userId, m.user.email as string]),
  );
  const invites = extras.invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    expired: isPast(i.expiresAt),
  }));
  const link = extras.joinCode
    ? {
        code: extras.joinCode.code,
        enabled: extras.joinCode.enabled,
        url: absoluteAppUrl(`/join/${extras.joinCode.code}`),
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
              trigger={
                <Button variant="create">
                  <UserPlus aria-hidden="true" />
                  Invite
                </Button>
              }
            />
          )
        }
        tabs={<PeopleTabs orgSlug={orgSlug} />}
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
        emails={emails}
        invites={invites}
        access={{
          role: role ?? "MEMBER",
          canManage,
          canInvite,
          canTransfer: can({ role }, "members.transferOwnership"),
        }}
      />
    </div>
  );
}
