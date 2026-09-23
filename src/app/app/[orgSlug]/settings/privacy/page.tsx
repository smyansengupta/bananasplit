import { Lock } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";

const BALLOT_COPY = {
  OWNER_ONLY: "Owners only",
  OWNER_AND_ADMINS: "Owners and admins",
  NOBODY: "Nobody",
} as const;

/**
 * Settings > Privacy (stub). Shows the current privacy settings; the Settings
 * builder adds editing (ballot visibility, result visibility, the minimum
 * cell size, member emails, the public events feed, database visibility).
 */
export default async function PrivacySettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/privacy">) {
  const { orgSlug } = await params;
  const { role, settings } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "privacy.write")) {
    return <SettingsNoAccess title="Privacy" who="owners and admins" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
      {settings && (
        <dl className="grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-[16rem_1fr]">
          <dt className="text-muted-foreground">Who sees individual votes</dt>
          <dd>{BALLOT_COPY[settings.ballotIndividualVisibility]}</dd>
          <dt className="text-muted-foreground">Members see ballot results</dt>
          <dd>{settings.ballotResultsVisibleToMembers ? "Yes" : "No"}</dd>
          <dt className="text-muted-foreground">Smallest result group shown</dt>
          <dd>{settings.ballotMinCellSize}</dd>
          <dt className="text-muted-foreground">Members see each other&apos;s emails</dt>
          <dd>{settings.showMemberEmailsToMembers ? "Yes" : "No"}</dd>
          <dt className="text-muted-foreground">Public events feed</dt>
          <dd>{settings.publicEventsEnabled ? "On" : "Off"}</dd>
        </dl>
      )}
      <EmptyState icon={Lock} title="Editing privacy settings is coming soon" />
    </div>
  );
}
