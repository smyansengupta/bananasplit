import { notFound, redirect } from "next/navigation";

import { CrmSettingsFrame } from "@/components/crm/settings/settings-frame";
import { CRM_SETTINGS_SECTION_VIEWS } from "@/components/crm/settings/sections";
import {
  canOpenSection,
  crmSettingsHref,
  defaultSection,
  findSection,
} from "@/lib/crm/settings-sections";

import { crmShell } from "../../shell";

export async function generateMetadata({
  params,
}: PageProps<"/app/[orgSlug]/crm/settings/[section]">) {
  const { section } = await params;
  return { title: findSection(section)?.label ?? "CRM settings" };
}

/**
 * One CRM settings section (docs/features/crm.md, "Redesign", Settings),
 * each its own URL: /crm/settings/{you, automations, sending, stages,
 * fields, templates, booking, phone, team, ai, import, api}. Old sub-pages
 * (webhooks) land on their section; a section the viewer can't open (or
 * Team and access in a Personal space) goes to the one they can.
 */
export default async function CrmSettingsSectionPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/settings/[section]">) {
  const { orgSlug, section: id } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const section = findSection(id);
  if (!section) notFound();
  if (section.id !== id) redirect(crmSettingsHref(orgSlug, section.id));
  const viewer = {
    admin: shell.access.admin,
    manager: shell.access.manager,
    personal: shell.access.personal,
  };
  if (!canOpenSection(section, viewer)) redirect(crmSettingsHref(orgSlug, defaultSection(viewer)));
  const View = CRM_SETTINGS_SECTION_VIEWS[section.id];
  return (
    <CrmSettingsFrame orgSlug={orgSlug} viewer={viewer} section={section}>
      <View shell={shell} orgSlug={orgSlug} sp={sp} />
    </CrmSettingsFrame>
  );
}
