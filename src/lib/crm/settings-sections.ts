/**
 * CRM settings' sections (docs/features/crm.md, "Redesign", Settings): one
 * page with the list on the left, each section its own URL,
 * /crm/settings/{id}. Who sees which: You, Templates and Booking link are
 * every member's own; the rest are for whoever runs the CRM (owners, admins
 * and CRM managers), and a few for owners and admins only. A Personal space
 * has no Team and access, and no Hand people over. Pure: the page, the nav
 * and the redirects read it.
 */

export type CrmSettingsSectionId =
  | "you"
  | "automations"
  | "sending"
  | "stages"
  | "fields"
  | "templates"
  | "booking"
  | "phone"
  | "team"
  | "handover"
  | "ai"
  | "import"
  | "api";

export interface CrmSettingsSection {
  id: CrmSettingsSectionId;
  label: string;
  /** The line under the title. */
  description: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** Who may open it: every member, CRM managers (and owners and admins), or owners and admins. */
  who: "member" | "manager" | "admin";
  /** Not in a Personal space (there's no team). */
  team?: boolean;
}

export const CRM_SETTINGS_SECTIONS: readonly CrmSettingsSection[] = [
  {
    id: "you",
    label: "You",
    description: "How the CRM works for you. Only you see these.",
    icon: "UserRound",
    who: "member",
  },
  {
    id: "automations",
    label: "Automations",
    description: "What the CRM does on its own, and how much it may do without asking.",
    icon: "Zap",
    who: "manager",
  },
  {
    id: "sending",
    label: "Sending",
    description: "Whose mailbox emails go out from, how fast, and whether they reach the inbox.",
    icon: "Send",
    who: "manager",
  },
  {
    id: "stages",
    label: "Deal stages and types",
    description: "The steps every deal moves through, and the kinds of deals you track.",
    icon: "Columns3",
    who: "manager",
  },
  {
    id: "fields",
    label: "Fields",
    description: "Extra details you want to keep on people, companies and deals.",
    icon: "ListChecks",
    who: "manager",
  },
  {
    id: "templates",
    label: "Templates",
    description: "Emails and texts you send often. Type / in any message to use one.",
    icon: "FileText",
    who: "member",
  },
  {
    id: "booking",
    label: "Booking link",
    description: "Booking links live in Meetings now: yours and the organization's.",
    icon: "CalendarClock",
    who: "member",
  },
  {
    id: "phone",
    label: "Phone and texts",
    description: "Calls and texts from the CRM, on numbers your organization owns.",
    icon: "Phone",
    who: "admin",
  },
  {
    id: "team",
    label: "Team and access",
    description: "Who sees what, who runs the CRM, and who new people go to.",
    icon: "Users",
    who: "admin",
    team: true,
  },
  {
    id: "handover",
    label: "Hand people over",
    description: "Members who left, people with no owner, and moving someone's people to someone else.",
    icon: "ArrowLeftRight",
    who: "manager",
    team: true,
  },
  {
    id: "ai",
    label: "AI",
    description: "Your organization's own AI, billed to your own key.",
    icon: "Sparkles",
    who: "manager",
  },
  {
    id: "import",
    label: "Import and export",
    description: "Bring people in from a spreadsheet. Take everything out any time.",
    icon: "FileSpreadsheet",
    who: "manager",
  },
  {
    id: "api",
    label: "API and webhooks",
    description: "Connect the CRM to your own tools.",
    icon: "Plug",
    who: "admin",
  },
];

/** Old URLs under /crm/settings that are now a section. */
export const CRM_SETTINGS_ALIASES: Readonly<Record<string, CrmSettingsSectionId>> = {
  webhooks: "api",
  keys: "api",
  mail: "you",
  handover: "handover",
  access: "team",
  pipelines: "stages",
};

export interface SettingsViewer {
  admin: boolean;
  manager: boolean;
  personal: boolean;
}

export function canOpenSection(section: CrmSettingsSection, viewer: SettingsViewer): boolean {
  if (section.team && viewer.personal) return false;
  if (section.who === "admin") return viewer.admin;
  if (section.who === "manager") return viewer.manager || viewer.admin;
  return true;
}

/** The sections this viewer sees, in order. */
export function visibleSections(viewer: SettingsViewer): CrmSettingsSection[] {
  return CRM_SETTINGS_SECTIONS.filter((s) => canOpenSection(s, viewer));
}

export function findSection(id: string): CrmSettingsSection | null {
  const real = CRM_SETTINGS_ALIASES[id] ?? id;
  return CRM_SETTINGS_SECTIONS.find((s) => s.id === real) ?? null;
}

/** Where /crm/settings opens: Automations for whoever runs the CRM, else You. */
export function defaultSection(viewer: SettingsViewer): CrmSettingsSectionId {
  return visibleSections(viewer)[viewer.manager || viewer.admin ? 1 : 0]?.id ?? "you";
}

export function crmSettingsHref(orgSlug: string, section: CrmSettingsSectionId, rest = ""): string {
  // Booking links moved to Meetings > Booking links (docs/features/booking.md);
  // the entry stays in CRM settings as a link there ("/{id}" opens that link's editor).
  if (section === "booking") return bookingLinksHref(orgSlug, rest.replace(/^\//, "") || null);
  return `/app/${orgSlug}/crm/settings/${section}${rest}`;
}

/** Meetings > Booking links, optionally opening one link's editor. */
export function bookingLinksHref(orgSlug: string, editId: string | null = null): string {
  const base = `/app/${orgSlug}/meetings/booking`;
  return editId ? `${base}?edit=${encodeURIComponent(editId)}` : base;
}
