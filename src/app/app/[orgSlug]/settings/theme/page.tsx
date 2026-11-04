import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { resolveTheme } from "@/lib/theme/resolve";
import { parsePersonalTheme } from "@/lib/theme/personal";
import { CUSTOM_PRESET_ID, findPreset } from "@/lib/theme/presets";
import { getOrgContextBySlug } from "@/server/db/context";
import { getViewerPrefs } from "@/server/profiles/queries";
import { planGate } from "@/server/billing/plan-gate";

import { SettingsNoAccess } from "../settings-no-access";

import { PersonalThemeNotice } from "./personal-theme-notice";
import { ThemeSettings } from "./theme-settings";

/**
 * Admin panel › Theme (OWNER/ADMIN): a preset or a custom palette for light
 * and dark, look and feel, the default mode (optionally locked), a preview
 * and the WCAG AA contrast check. Every change applies for everyone as it's
 * made, with Undo. How the logo shows is on General, beside the picture.
 * The action re-checks the permission and RLS enforces it again.
 */
export default async function ThemeSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/theme">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "themes");
  if (planLock) return planLock;
  const { organization, role, theme: row, user } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "theme.write")) {
    return <SettingsNoAccess title="Theme" who="owners and admins" />;
  }

  const theme = resolveTheme(row);
  const personal = parsePersonalTheme((await getViewerPrefs(user.id)).themePreference);
  const personalName = personal
    ? personal.preset === CUSTOM_PRESET_ID
      ? "Custom"
      : (findPreset(personal.preset)?.name ?? "Default")
    : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Theme" />
      {personalName && (
        <PersonalThemeNotice
          themeName={personalName}
          profileHref={`/app/${organization.slug}/profile#theme`}
          clubMode={theme.mode === "LIGHT" ? "light" : theme.mode === "DARK" ? "dark" : "system"}
        />
      )}
      <ThemeSettings
        orgId={organization.id}
        orgName={organization.name}
        initial={{
          preset: theme.preset,
          mode: theme.mode,
          lockMode: theme.lockMode,
          logoDisplay: theme.logoDisplay,
          light: theme.light,
          dark: theme.dark,
          style: theme.style,
        }}
        isDefault={theme.isDefault}
        personalThemeName={personalName}
      />
    </div>
  );
}
