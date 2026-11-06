import { UserPlus } from "@/components/icons";

import { PageHeader } from "@/components/page-header";
import {
  PeopleAmbient,
  type Newcomer,
  type WaitingInvite,
} from "@/components/profile/people-ambient";
import { parseDirectoryQuery } from "@/components/profile/directory-query";
import { PeopleDirectory } from "@/components/profile/people-directory";
import { Button } from "@/components/ui/button";
import {
  NEWCOMER_DISMISSAL,
  inviteReason,
  joinedThisWeek,
  newcomerReason,
  staleInviteDays,
} from "@/lib/ambient/people";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { INVITATION_EXPIRY_DAYS } from "@/lib/invitations";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { getPersonSheet, loadDirectory, saidHiTo } from "@/server/profiles/directory";
import { planGate } from "@/server/billing/plan-gate";
import type { DirectoryPerson } from "@/server/profiles/directory";

import { InviteDialog } from "../settings/members/invite-dialog";
import { loadOrgChartSection } from "../org-chart/chart-section";

/** How many newcomers and waiting invites show over the list. */
const AMBIENT_ROWS = 5;

/**
 * Who's new this week and which invites have waited three days, for the
 * ambient rows over the list. Request-time, outside the render body
 * (react-hooks/purity).
 */
function ambientRows(
  people: DirectoryPerson[],
  invites: { id: string; email: string; expiresAt: Date }[],
  viewerId: string,
  dismissed: ReadonlySet<string>,
): { newcomers: Newcomer[]; waiting: WaitingInvite[] } {
  const now = new Date();
  const newcomers = people
    .filter((p) => p.id !== viewerId && !dismissed.has(p.id) && joinedThisWeek(p.joinedAt, now))
    .slice(0, AMBIENT_ROWS)
    .map((p) => ({
      id: p.id,
      name: p.name,
      user: p,
      reason: newcomerReason(p.joinedAt, Boolean(p.teamKey), now),
      hasTeam: Boolean(p.teamKey),
    }));
  const waiting = invites
    .map((i) => {
      // A resend restarts the expiry, so the last send is a week before it.
      const sentAt = new Date(i.expiresAt.getTime() - INVITATION_EXPIRY_DAYS * 86_400_000);
      const days = staleInviteDays(sentAt.toISOString(), now);
      return days === null ? null : { id: i.id, email: i.email, reason: inviteReason(days) };
    })
    .filter((i): i is WaitingInvite => i !== null)
    .slice(0, AMBIENT_ROWS);
  return { newcomers, waiting };
}

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

  const [directory, joinCode, chart, invites, dismissals] = await Promise.all([
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
    // Invites still out, for Resend invite (those who may invite).
    canInvite
      ? withOrgTx(orgId, ({ db }) =>
          db.invitation.findMany({
            where: { organizationId: orgId, acceptedAt: null },
            orderBy: { expiresAt: "asc" },
            take: 50,
            select: { id: true, email: true, expiresAt: true },
          }),
        )
      : Promise.resolve([]),
    // The newcomers this member dismissed (own-row RLS).
    withOrgTx(orgId, ({ db }) =>
      db.upNextDismissal.findMany({
        where: { organizationId: orgId, userId: user.id, kind: NEWCOMER_DISMISSAL },
        select: { refId: true },
      }),
    ),
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
  const rows = ambientRows(people, invites, user.id, new Set(dismissals.map((d) => d.refId)));
  // Said hi already, and on a team: nothing left to do for them.
  const greeted = await saidHiTo(
    organization.id,
    user.id,
    rows.newcomers.map((n) => n.id),
  );
  const ambient = {
    ...rows,
    newcomers: rows.newcomers
      .map((n) => ({ ...n, saidHi: greeted.has(n.id) }))
      .filter((n) => !n.saidHi || !n.hasTeam),
  };
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
      {query.view !== "chart" && (
        <PeopleAmbient
          orgId={orgId}
          orgSlug={orgSlug}
          newcomers={ambient.newcomers}
          invites={ambient.waiting}
        />
      )}
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
        canManageTasks={can({ role }, "tasks.manageAll")}
      />
    </div>
  );
}
