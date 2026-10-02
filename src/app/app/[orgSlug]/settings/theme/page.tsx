import { can } from "@/lib/auth/permissions";
import { orgLogoSource } from "@/lib/theme/logo";
import { resolveTheme } from "@/lib/theme/resolve";
import { parsePersonalTheme } from "@/lib/theme/personal";
import { CUSTOM_PRESET_ID, findPreset } from "@/lib/theme/presets";
import { getOrgContextBySlug } from "@/server/db/context";
import { getViewerPrefs } from "@/server/profiles/queries";

import { SettingsNoAccess } from "../settings-no-access";

import { PersonalThemeNotice } from "./personal-theme-notice";
import { ThemeSettings } from "./theme-settings";

/**
 * Settings > Theme (Phase 8, OWNER/ADMIN): a preset or a custom palette for
 * light and dark, the default mode (optionally locked), how the logo shows,
 * a live preview and the WCAG AA contrast check. The action re-checks the
 * permission and RLS enforces it again.
 */
export default async function ThemeSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/theme">) {
  const { orgSlug } = await params;
  const { organization, role, theme: row, user } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "theme.write")) {
    return <SettingsNoAccess title="Theme" who="owners and admins" />;
  }

  const theme = resolveTheme(row);
  const logo = orgLogoSource(organization.logo, 64);
  const personal = parsePersonalTheme((await getViewerPrefs(user.id)).themePreference);
  const personalName = personal
    ? personal.preset === CUSTOM_PRESET_ID
      ? "Custom"
      : (findPreset(personal.preset)?.name ?? "Default")
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="page-title">Theme</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Colours, logo and light or dark mode for everyone in {organization.name}, including the
          org&apos;s public poll and invite pages. Changes apply as soon as you save.
        </p>
      </div>
      {personalName && (
        <PersonalThemeNotice
          themeName={personalName}
          profileHref={`/app/${organization.slug}/profile#theme`}
          clubMode={theme.mode === "LIGHT" ? "light" : theme.mode === "DARK" ? "dark" : "system"}
        />
      )}
      <ThemeSettings
        orgId={organization.id}
        orgSlug={organization.slug}
        orgName={organization.name}
        logo={organization.logo}
        hasLogo={logo !== null}
        initial={{
          preset: theme.preset,
          mode: theme.mode,
          lockMode: theme.lockMode,
          logoDisplay: theme.logoDisplay,
          light: theme.light,
          dark: theme.dark,
        }}
        isDefault={theme.isDefault}
        personalThemeName={personalName}
      />
    </div>
  );
}
