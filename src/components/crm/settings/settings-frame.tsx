import type { ReactNode } from "react";

import { SettingsCloseFloat } from "@/components/settings-close";
import {
  crmSettingsHref,
  visibleSections,
  type CrmSettingsSection,
  type SettingsViewer,
} from "@/lib/crm/settings-sections";

import { CrmSettingsNav } from "./settings-nav";

/**
 * Every CRM settings page (docs/features/crm.md, "Redesign", Settings): the
 * title and, kept in view at the top right, the black Close back to where
 * you came from (Today by default); then the section list on the left and
 * the open section's cards on the right. With only one section to open
 * (a member's You) there's no list. `overlays` is what's open over it
 * (CrmOverlays, ?open=): an automation, a follow-up series, any card.
 */
export function CrmSettingsFrame({
  orgSlug,
  viewer,
  section,
  overlays,
  children,
}: {
  orgSlug: string;
  viewer: SettingsViewer;
  section: CrmSettingsSection;
  /** The card open over the page (CrmOverlays), rendered once after it. */
  overlays?: ReactNode;
  children: ReactNode;
}) {
  const items = visibleSections(viewer).map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    href: crmSettingsHref(orgSlug, s.id),
  }));
  const list = items.length > 1;
  return (
    <div>
      <SettingsCloseFloat orgSlug={orgSlug} fallback={`/app/${orgSlug}/crm`} />
      <div className="mb-[30px] flex min-h-9 items-end max-md:mb-5">
        <h1 className="page-title min-w-0">CRM settings</h1>
      </div>
      <div className={list ? "grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-7.5" : undefined}>
        {list && (
          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <CrmSettingsNav items={items} />
          </aside>
        )}
        <div className="min-w-0 space-y-4.5">
          <h2 className="display-title pb-1 text-[28px] sm:text-[34px]">{section.label}</h2>
          {children}
        </div>
      </div>
      {overlays}
    </div>
  );
}
