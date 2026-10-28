import { Database } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { SettingsCard } from "../settings-card";
import { SettingsNoAccess } from "../settings-no-access";
import { BallotVisibilityForm, DatabaseVisibilityRow, PrivacyForm } from "./privacy-forms";

const VOTE_SUMMARY: Record<string, string> = {
  OWNER_ONLY: "votes visible to owners",
  OWNER_AND_ADMINS: "votes visible to owners and admins",
  NOBODY: "votes visible to nobody",
};

/**
 * Settings > Privacy (OWNER/ADMIN): ballot privacy, member and contact
 * emails, the public events feed and which databases members can see.
 * Individual-vote visibility is OWNER-only.
 */
export default async function PrivacySettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/privacy">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "privacy");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "privacy.write")) {
    return <SettingsNoAccess title="Privacy" who="owners and admins" />;
  }

  const { settings, databases } = await withOrgTx(organization.id, async ({ db }) => ({
    settings: await db.orgSettings.findUniqueOrThrow({
      where: { organizationId: organization.id },
      select: {
        ballotIndividualVisibility: true,
        ballotResultsVisibleToMembers: true,
        ballotMinCellSize: true,
        showMemberEmailsToMembers: true,
        publicEventsEnabled: true,
        contactEmailVisibility: true,
      },
    }),
    databases: await db.databaseDefinition.findMany({
      where: { organizationId: organization.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, memberVisibility: true },
    }),
  }));

  const votes = VOTE_SUMMARY[settings.ballotIndividualVisibility] ?? "votes private";
  const hidden = databases.filter((d) => d.memberVisibility === "HIDDEN").length;
  const summary = [
    votes,
    settings.showMemberEmailsToMembers ? "member emails shown" : "member emails hidden",
    settings.publicEventsEnabled ? "public feed on" : "public feed off",
    databases.length > 0
      ? `${hidden} of ${databases.length} database${databases.length === 1 ? "" : "s"} hidden`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-3xl space-y-7.5">
      <PageHeader
        title="Privacy"
        description={summary.charAt(0).toUpperCase() + summary.slice(1)}
      />

      <div className="space-y-4.5">
        <BallotVisibilityForm
          orgId={organization.id}
          value={settings.ballotIndividualVisibility}
          canEdit={can({ role }, "privacy.ballots")}
        />

        <PrivacyForm
          orgId={organization.id}
          canEdit
          initial={{
            ballotResultsVisibleToMembers: settings.ballotResultsVisibleToMembers,
            ballotMinCellSize: settings.ballotMinCellSize,
            showMemberEmailsToMembers: settings.showMemberEmailsToMembers,
            publicEventsEnabled: settings.publicEventsEnabled,
            contactEmailVisibility: settings.contactEmailVisibility,
          }}
        />

        <SettingsCard
          title="Databases"
          description="Who can browse each database. “Hidden” removes it from the members' list; owners and admins can always open it to manage it. Changes save as you pick."
        >
          {databases.length === 0 ? (
            <EmptyState
              size="compact"
              icon={Database}
              title="No databases yet."
              description="Databases you add show here, each with who can browse it."
              className="py-0"
            />
          ) : (
            <ul className="divide-border/70 divide-y">
              {databases.map((d) => (
                <DatabaseVisibilityRow
                  key={d.id}
                  orgId={organization.id}
                  id={d.id}
                  name={d.name}
                  value={d.memberVisibility}
                  canEdit
                />
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}
