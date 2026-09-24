import { can } from "@/lib/auth/permissions";
import { orgLogoSource } from "@/lib/theme/logo";
import { resolveTheme } from "@/lib/theme/resolve";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";

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
  const { organization, role, theme: row } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "theme.write")) {
    return <SettingsNoAccess title="Theme" who="owners and admins" />;
  }

  const theme = resolveTheme(row);
  const logo = orgLogoSource(organization.logo, 64);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Theme</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Colours, logo and light or dark mode for everyone in {organization.name}, including the
          org&apos;s public poll and invite pages. Changes apply as soon as you save.
        </p>
      </div>
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
      />
    </div>
  );
}
