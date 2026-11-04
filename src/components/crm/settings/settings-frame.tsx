import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { CrmHeader } from "@/components/crm/chrome/crm-header";
import {
  crmSettingsHref,
  visibleSections,
  type CrmSettingsSection,
  type SettingsViewer,
} from "@/lib/crm/settings-sections";

import { CrmSettingsNav } from "./settings-nav";

/**
 * Every CRM settings page (docs/features/crm.md, "Redesign", Settings): the
 * CRM header titled "CRM settings" with no create button, then the
 * section list on the left and the open section on the right, its title
 * and line on top and its SettingsCards under them. A page under a section
 * (one automation, one booking page) passes `back` and its own title.
 * `overlays` is what's open over it (CrmOverlays, ?open=): a follow-up
 * series' card opens over Automations, and any card a link sets.
 */
export function CrmSettingsFrame({
  orgSlug,
  viewer,
  section,
  title,
  description,
  back,
  overlays,
  children,
}: {
  orgSlug: string;
  viewer: SettingsViewer;
  section: CrmSettingsSection;
  /** Defaults to the section's label. */
  title?: ReactNode;
  description?: ReactNode;
  /** A page under the section: the link back to it. */
  back?: { href: string; label: string };
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
  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        settings={viewer.manager || viewer.admin}
        title="CRM settings"
        create={false}
      />
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-7.5">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <CrmSettingsNav items={items} />
        </aside>
        <div className="min-w-0 space-y-4.5">
          {back && <BackLink href={back.href} label={back.label} />}
          <header className="space-y-1.5 pb-1">
            <h2 className="display-title text-[28px] sm:text-[34px]">{title ?? section.label}</h2>
            <p className="text-muted-foreground max-w-prose text-[15px]">
              {description ?? section.description}
            </p>
          </header>
          {children}
        </div>
      </div>
      {overlays}
    </div>
  );
}
