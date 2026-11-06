import { notFound, redirect } from "next/navigation";

import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { CrmSettingsFrame } from "@/components/crm/settings/settings-frame";
import { CRM_SETTINGS_SECTION_VIEWS } from "@/components/crm/settings/sections";
import {
  bookingLinksHref,
  canOpenSection,
  crmSettingsAliasHref,
  crmSettingsHref,
  defaultSection,
  findSection,
} from "@/lib/crm/settings-sections";
import { hrefWithOpen, OPEN_PARAM, parseOpen } from "@/lib/crm/overlay";

import { crmSettingsShell } from "../../shell";

export async function generateMetadata({
  params,
}: PageProps<"/app/[orgSlug]/crm/settings/[section]">) {
  const { section } = await params;
  return { title: findSection(section)?.label ?? "CRM settings" };
}

/**
 * One CRM settings section (docs/features/crm.md, "Redesign", Settings),
 * each its own URL: /crm/settings/{you, automations, deals, team,
 * connections}. Old sections (sending, templates, webhooks...) land on the
 * section they're part of, with their query and their card's anchor; a
 * section the viewer can't open (or Team in a Personal space) goes to the
 * one they can, except a card it was opening (a follow-up series' link from
 * the Inbox), which opens over People instead. Every section renders the
 * CRM's cards (?open=).
 */
export default async function CrmSettingsSectionPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/settings/[section]">) {
  const { orgSlug, section: id } = await params;
  // Meeting links moved to Meetings (docs/features/booking.md).
  if (id === "booking") redirect(bookingLinksHref(orgSlug));
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmSettingsShell(orgSlug);
  if (!shell) return gate;
  const section = findSection(id);
  if (!section) notFound();
  if (section.id !== id) redirect(crmSettingsAliasHref(orgSlug, id, sp) ?? crmSettingsHref(orgSlug, section.id));
  // Recipes and Scores were views of the page; they open over it now.
  if (section.id === "automations" && (sp.view === "recipes" || sp.view === "scoring")) {
    redirect(crmSettingsHref(orgSlug, section.id, `?open=${sp.view}`));
  }
  const viewer = {
    admin: shell.access.admin,
    manager: shell.access.manager,
    personal: shell.access.personal,
  };
  if (!canOpenSection(section, viewer)) {
    const open = parseOpen(sp[OPEN_PARAM]);
    redirect(
      open
        ? hrefWithOpen(`/app/${orgSlug}/crm/people`, "", open)
        : crmSettingsHref(orgSlug, defaultSection(viewer)),
    );
  }
  const View = CRM_SETTINGS_SECTION_VIEWS[section.id];
  return (
    <CrmSettingsFrame
      orgSlug={orgSlug}
      viewer={viewer}
      section={section}
      overlays={<CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />}
    >
      <View shell={shell} orgSlug={orgSlug} sp={sp} />
    </CrmSettingsFrame>
  );
}
