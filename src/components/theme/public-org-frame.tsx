import { OrgBrand } from "@/components/theme/org-brand";
import { OrgThemeRoot } from "@/components/theme/org-theme-root";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import type { PublicOrgTheme } from "@/lib/theme/loader";

/**
 * The frame of an org-owned public page (/poll/[pollId], /invite/[token]):
 * the org's theme (tokens, default mode, lock) and a header with its logo
 * and name. An unknown poll or invite gets the plain default theme and no
 * header, so a bad link reveals nothing about any org.
 */
export function PublicOrgFrame({
  org,
  children,
}: {
  org: PublicOrgTheme | null;
  children: React.ReactNode;
}) {
  if (!org) {
    return <PublicThemeRoot>{children}</PublicThemeRoot>;
  }
  return (
    <OrgThemeRoot theme={org.theme}>
      <div className="flex flex-1 flex-col">
        <header className="border-b px-6 py-3">
          <div className="mx-auto flex w-full max-w-2xl items-center">
            <OrgBrand name={org.name} logo={org.logo} display={org.theme.logoDisplay} />
          </div>
        </header>
        {children}
      </div>
    </OrgThemeRoot>
  );
}
