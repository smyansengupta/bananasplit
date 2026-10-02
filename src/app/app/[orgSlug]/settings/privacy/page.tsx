import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";
import { BallotVisibilityForm, DatabaseVisibilityRow, PrivacyForm } from "./privacy-forms";

/**
 * Settings > Privacy (OWNER/ADMIN): ballot privacy, member and contact
 * emails, the public events feed and which databases members can see.
 * Individual-vote visibility is OWNER-only.
 */
export default async function PrivacySettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/privacy">) {
  const { orgSlug } = await params;
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

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="page-title">Privacy</h1>

      <section className="space-y-3">
        <h2 className="font-medium">Ballots</h2>
        <BallotVisibilityForm
          orgId={organization.id}
          value={settings.ballotIndividualVisibility}
          canEdit={can({ role }, "privacy.ballots")}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Members, contacts and the public feed</h2>
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
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Databases</h2>
          <p className="text-muted-foreground text-sm">
            Who can browse each database. &ldquo;Hidden&rdquo; removes it from the members&apos;
            list; owners and admins can always open it to manage it.
          </p>
        </div>
        {databases.length === 0 ? (
          <p className="text-muted-foreground text-sm">No databases yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
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
      </section>
    </div>
  );
}
