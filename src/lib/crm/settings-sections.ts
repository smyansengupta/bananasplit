/**
 * CRM settings' sections (docs/features/crm.md, "Redesign", Settings): five
 * pages, the list on the left, each section its own URL,
 * /crm/settings/{id}, and nothing under them: what used to be a page opens
 * in place as a dialog (?open=). Who sees which: You is every member's own;
 * the rest are for whoever runs the CRM (owners, admins and CRM managers),
 * and a section hides the cards only owners and admins may touch. A Personal
 * space has no Team. Pure: the page, the nav and the redirects read it.
 */

export type CrmSettingsSectionId = "you" | "automations" | "deals" | "team" | "connections";

export interface CrmSettingsSection {
  id: CrmSettingsSectionId;
  label: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** Who may open it: every member, or CRM managers (and owners and admins). */
  who: "member" | "manager";
  /** Not in a Personal space (there's no team). */
  team?: boolean;
}

export const CRM_SETTINGS_SECTIONS: readonly CrmSettingsSection[] = [
  { id: "you", label: "You", icon: "UserRound", who: "member" },
  { id: "automations", label: "Automations and sending", icon: "Zap", who: "manager" },
  { id: "deals", label: "Deals and fields", icon: "Columns3", who: "manager" },
  { id: "team", label: "Team", icon: "Users", who: "manager", team: true },
  { id: "connections", label: "Connections", icon: "Plug", who: "manager" },
];

/**
 * Old URLs under /crm/settings and the section they're part of now, with
 * the card to land on. Links in old emails, Inbox items and pins keep
 * working through these (crmSettingsAliasHref).
 */
export const CRM_SETTINGS_ALIASES: Readonly<
  Record<string, { section: CrmSettingsSectionId; hash?: string; search?: Record<string, string> }>
> = {
  mail: { section: "you" },
  templates: { section: "you", hash: "templates" },
  sending: { section: "automations", hash: "sending" },
  stages: { section: "deals" },
  pipelines: { section: "deals" },
  fields: { section: "deals", hash: "fields", search: { for: "people" } },
  access: { section: "team" },
  handover: { section: "team", hash: "handover" },
  ai: { section: "connections", hash: "ai" },
  phone: { section: "connections", hash: "phone" },
  import: { section: "connections", hash: "import" },
  api: { section: "connections", hash: "api" },
  keys: { section: "connections", hash: "api" },
  webhooks: { section: "connections", hash: "webhooks" },
};

export interface SettingsViewer {
  admin: boolean;
  manager: boolean;
  personal: boolean;
}

export function canOpenSection(section: CrmSettingsSection, viewer: SettingsViewer): boolean {
  if (section.team && viewer.personal) return false;
  if (section.who === "manager") return viewer.manager || viewer.admin;
  return true;
}

/** The sections this viewer sees, in order. */
export function visibleSections(viewer: SettingsViewer): CrmSettingsSection[] {
  return CRM_SETTINGS_SECTIONS.filter((s) => canOpenSection(s, viewer));
}

export function findSection(id: string): CrmSettingsSection | null {
  const real = CRM_SETTINGS_ALIASES[id]?.section ?? id;
  return CRM_SETTINGS_SECTIONS.find((s) => s.id === real) ?? null;
}

/** Where /crm/settings opens: Automations for whoever runs the CRM, else You. */
export function defaultSection(viewer: SettingsViewer): CrmSettingsSectionId {
  return visibleSections(viewer)[viewer.manager || viewer.admin ? 1 : 0]?.id ?? "you";
}

export function crmSettingsHref(orgSlug: string, section: CrmSettingsSectionId, rest = ""): string {
  return `/app/${orgSlug}/crm/settings/${section}${rest}`;
}

/** Where an old section's URL lands, with its query kept (?open=, ?role=, ?for=) and its card's anchor. */
export function crmSettingsAliasHref(
  orgSlug: string,
  id: string,
  search: Readonly<Record<string, string | undefined>> = {},
): string | null {
  const alias = CRM_SETTINGS_ALIASES[id];
  if (!alias) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...alias.search, ...search })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return crmSettingsHref(
    orgSlug,
    alias.section,
    `${query ? `?${query}` : ""}${alias.hash ? `#${alias.hash}` : ""}`,
  );
}

/** Meetings > Booking links, optionally opening one link's editor. */
export function bookingLinksHref(orgSlug: string, editId: string | null = null): string {
  const base = `/app/${orgSlug}/meetings/booking`;
  return editId ? `${base}?edit=${encodeURIComponent(editId)}` : base;
}
