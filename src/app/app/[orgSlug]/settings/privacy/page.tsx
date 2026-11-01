import { Database } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { connectorsConfig } from "@/server/connectors/config";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { SettingsCard } from "../settings-card";
import { SettingsNoAccess } from "../settings-no-access";
import { ConnectorsSwitchForm, DatabaseVisibilityRow, PrivacySettings } from "./privacy-forms";

/**
 * Admin panel › Privacy (OWNER/ADMIN): ballots (who sees individual votes,
 * OWNER-only to change; whether members see results; the smallest group
 * shown), member and contact emails, the public events feed, AI apps while
 * the deployment has them, and who can browse each database. Every control
 * saves as it changes.
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
        connectorsEnabled: true,
      },
    }),
    databases: await db.databaseDefinition.findMany({
      where: { organizationId: organization.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, memberVisibility: true },
    }),
  }));

  const connectorsOn = connectorsConfig() !== null;

  return (
    <div className="max-w-3xl space-y-7.5">
      <PageHeader title="Privacy" />

      <div className="space-y-4.5">
        <PrivacySettings
          orgId={organization.id}
          orgSlug={organization.slug}
          ballotVisibility={settings.ballotIndividualVisibility}
          canEditBallots={can({ role }, "privacy.ballots")}
          initial={{
            ballotResultsVisibleToMembers: settings.ballotResultsVisibleToMembers,
            ballotMinCellSize: settings.ballotMinCellSize,
            showMemberEmailsToMembers: settings.showMemberEmailsToMembers,
            publicEventsEnabled: settings.publicEventsEnabled,
            contactEmailVisibility: settings.contactEmailVisibility,
          }}
        />

        {connectorsOn && (
          <ConnectorsSwitchForm
            orgId={organization.id}
            value={settings.connectorsEnabled}
            canEdit
          />
        )}

        <SettingsCard title="Databases" description="Admins can always open hidden databases.">
          {databases.length === 0 ? (
            <EmptyState size="compact" icon={Database} title="No databases yet." className="py-0" />
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
