import { OrgBrand } from "@/components/theme/org-brand";
import { OrgThemeRoot } from "@/components/theme/org-theme-root";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import type { PublicOrgTheme } from "@/lib/theme/loader";
import { cn } from "@/lib/utils";

/**
 * The frame of an org-owned public page (/poll/[pollId], /invite/[token]):
 * the org's theme (tokens, default mode, lock) and a header with its logo
 * and name. An unknown poll or invite gets the plain default theme and no
 * header, so a bad link reveals nothing about any org.
 */
export function PublicOrgFrame({
  org,
  children,
  wide = false,
}: {
  org: PublicOrgTheme | null;
  children: React.ReactNode;
  /** Line the header up with a wide page (the poll's grid) instead of a narrow form. */
  wide?: boolean;
}) {
  if (!org) {
    return <PublicThemeRoot>{children}</PublicThemeRoot>;
  }
  return (
    <OrgThemeRoot theme={org.theme}>
      <div className="flex flex-1 flex-col">
        <header className="border-b px-6 py-3">
          <div className={cn("mx-auto flex w-full items-center", wide ? "max-w-5xl" : "max-w-2xl")}>
            <OrgBrand name={org.name} logo={org.logo} display={org.theme.logoDisplay} />
          </div>
        </header>
        {children}
      </div>
    </OrgThemeRoot>
  );
}
