import { PageHeader } from "@/components/page-header";
import { appOrigin } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { DEFAULT_REMINDER_MINUTES } from "@/lib/meetings/reminders";
import { orgLogoUrl } from "@/lib/org-logo";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";
import {
  LogoForm,
  MeetingRemindersForm,
  NameForm,
  SlugForm,
  TimezoneForm,
  WeeklyUpdateDayForm,
} from "./general-forms";

/**
 * Settings > General: name and timezone (OWNER/ADMIN), the club picture (OWNER/ADMIN),
 * the URL (OWNER only; old URLs redirect and stay reserved), the reminders a
 * new meeting starts with, and the weekly update day (OWNER/ADMIN, in a club).
 */
export default async function GeneralSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/general">) {
  const { orgSlug } = await params;
  const { organization, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="General" who="owners and admins" />;
  }
  const canWrite = can({ role }, "settings.general.write");
  const host = appOrigin().replace(/^https?:\/\//, "");

  return (
    <div className="max-w-3xl space-y-7.5">
      <PageHeader
        title="General"
        description={`${host}/app/${organization.slug} · ${organization.timezone}`}
      />
      <div className="space-y-4.5">
        <LogoForm
          orgId={organization.id}
          orgName={organization.name}
          logoUrl={orgLogoUrl(organization.logo, 256)}
          canEdit={can({ role }, "org.logo.write")}
        />
        <NameForm orgId={organization.id} name={organization.name} canEdit={canWrite} />
        <SlugForm
          orgId={organization.id}
          slug={organization.slug}
          canEdit={can({ role }, "org.slug.write")}
          appOrigin={appOrigin()}
        />
        <TimezoneForm orgId={organization.id} timezone={organization.timezone} canEdit={canWrite} />
        <MeetingRemindersForm
          orgId={organization.id}
          minutes={settings?.meetingReminderMinutes ?? [...DEFAULT_REMINDER_MINUTES]}
          canEdit={canWrite}
        />
        {spaceIncludes(organization, "teamwork") && (
          <WeeklyUpdateDayForm
            orgId={organization.id}
            day={settings?.weeklyUpdateDay ?? 0}
            canEdit={canWrite}
          />
        )}
      </div>
    </div>
  );
}
