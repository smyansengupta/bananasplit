import { PageHeader } from "@/components/page-header";
import { appOrigin } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { DEFAULT_REMINDER_MINUTES } from "@/lib/meetings/reminders";
import { orgLogoUrl } from "@/lib/org-logo";
import { DEFAULT_PULSE_SETTINGS } from "@/lib/pulse/settings";
import { resolveTheme } from "@/lib/theme/resolve";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsCard } from "../settings-card";
import { SettingsNoAccess } from "../settings-no-access";
import {
  LogoDisplayField,
  LogoForm,
  MeetingRemindersField,
  NameField,
  PulseField,
  TimezoneField,
  UrlField,
  WeeklyUpdateDayField,
} from "./general-forms";

/**
 * Admin panel › General, where the panel opens. Two cards, every field
 * saving the moment it changes:
 * - Organization: the picture (and, with themes, how it shows), the name,
 *   the URL (owners; old URLs redirect and stay reserved) and the timezone.
 * - Schedule: the reminders a new meeting starts with, the weekly update
 *   day and the weekly pulse (each where the plan has it).
 */
export default async function GeneralSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/general">) {
  const { orgSlug } = await params;
  const { organization, role, settings, theme } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="General" who="owners and admins" />;
  }
  const canWrite = can({ role }, "settings.general.write");
  const personal = organization.kind === "PERSONAL";
  const showLogoDisplay = can({ role }, "theme.write") && spaceIncludes(organization, "themes");
  const showWeekly = spaceIncludes(organization, "teamwork");
  const showPulse = !personal && spaceIncludes(organization, "overview");
  const pulse = settings
    ? {
        pulseEnabled: settings.pulseEnabled,
        pulseDay: settings.pulseDay,
        pulseHourLocal: settings.pulseHourLocal,
        pulseAudience: settings.pulseAudience,
        pulseEmail: settings.pulseEmail,
        pulseInApp: settings.pulseInApp,
      }
    : DEFAULT_PULSE_SETTINGS;

  return (
    <div className="max-w-3xl space-y-7.5">
      <PageHeader title="General" />
      <div className="space-y-4.5">
        <SettingsCard title="Organization" id="organization">
          <div className="space-y-6">
            <LogoForm
              orgId={organization.id}
              orgName={organization.name}
              logoUrl={orgLogoUrl(organization.logo, 256)}
              canEdit={can({ role }, "org.logo.write")}
            />
            {showLogoDisplay && (
              <LogoDisplayField orgId={organization.id} value={resolveTheme(theme).logoDisplay} />
            )}
            <NameField orgId={organization.id} name={organization.name} canEdit={canWrite} />
            <UrlField
              orgId={organization.id}
              slug={organization.slug}
              canEdit={can({ role }, "org.slug.write")}
              appOrigin={appOrigin()}
            />
            <TimezoneField
              orgId={organization.id}
              timezone={organization.timezone}
              canEdit={canWrite}
            />
          </div>
        </SettingsCard>
        <SettingsCard title="Schedule" id="schedule">
          <div className="space-y-6">
            <MeetingRemindersField
              orgId={organization.id}
              minutes={settings?.meetingReminderMinutes ?? [...DEFAULT_REMINDER_MINUTES]}
              canEdit={canWrite}
            />
            {showWeekly && (
              <WeeklyUpdateDayField
                orgId={organization.id}
                day={settings?.weeklyUpdateDay ?? 0}
                canEdit={canWrite}
              />
            )}
            {showPulse && (
              <PulseField
                orgId={organization.id}
                orgSlug={organization.slug}
                initial={pulse}
                canEdit={canWrite}
              />
            )}
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
