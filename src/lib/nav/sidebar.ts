import { z } from "zod";

import { isAddOn } from "@/lib/addons";
import type { PlanFeature } from "@/lib/billing/features";

/**
 * The org's sidebar (OrgSettings.sidebar): which sections show, in what
 * order, under which heading, and what they're called. Owners and admins
 * edit it in Settings › Sidebar; NULL is the default below. Overview and
 * Settings always stay. Hiding a section tidies the app; it is not a
 * permission (the data rules don't change), and admins can still open it.
 */

export const SECTION_IDS = [
  "overview",
  "inbox",
  "people",
  "tasks",
  "calendar",
  "meetings",
  "forms",
  "databases",
  "notes",
  "integrations",
  "finance",
  "crm",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/**
 * Sections that used to be separate and still appear in saved sidebars:
 * accepted when reading a saved config, then dropped. The org chart is part
 * of People now, RSVPs became Meetings, Polls became Forms, and Find a time
 * lives inside Meetings (see RENAMED_FROM, which carries a saved sidebar's
 * choice across a rename).
 */
const RETIRED_SECTION_IDS = ["org-chart", "rsvps", "polls", "find-a-time"] as const;

/**
 * The sidebar's groups, in the order people reach for them. The sidebar
 * names them (SECTION_NAMES, src/components/shell/sidebar-nav.tsx): the
 * first has no name, then Planning, Data, and Integrations and apps. "money"
 * is empty by default and stays for saved sidebars that put things there.
 */
export const GROUP_IDS = ["main", "plan", "collect", "workspace", "money"] as const;
export type GroupId = (typeof GROUP_IDS)[number];
/** Group ids older saved sidebars used; read, then ignored (each section goes to its own group). */
const LEGACY_GROUP_IDS = ["club", "data"] as const;

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Icon name (@/components/icons), resolved in the sidebar. */
  icon: string;
  /** Path under /app/{slug}. */
  path: string;
  /** Other paths (under /app/{slug}) that belong to this section. */
  also?: string[];
  exact?: boolean;
  group: GroupId;
  /** Can't be hidden. */
  locked?: boolean;
  description: string;
}

// Home, Inbox and People first (yours and who's here); then planning
// (Tasks, Calendar, Meetings); then the organization's data (Files, then
// Databases); then Integrations and apps: Integrations itself, then each add-on
// the organization has added (Forms, Finance, CRM; src/lib/addons.ts).
export const SECTIONS: readonly SectionDef[] = [
  {
    id: "overview",
    label: "Home",
    icon: "House",
    path: "",
    exact: true,
    group: "main",
    locked: true,
    description: "Each member's home page.",
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: "Inbox",
    path: "/inbox",
    group: "main",
    locked: true,
    description: "Everything waiting on you.",
  },
  {
    id: "people",
    label: "People",
    icon: "Users",
    path: "/people",
    also: ["/org-chart"],
    group: "main",
    description: "The member directory and the org chart.",
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: "CheckSquare",
    path: "/tasks",
    group: "plan",
    description: "Who's doing what, and by when.",
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "CalendarDays",
    path: "/calendar",
    group: "plan",
    description: "Meetings and events.",
  },
  {
    id: "meetings",
    label: "Meetings",
    icon: "Video",
    path: "/meetings",
    also: ["/calendar/rsvp", "/calendar/find-a-time"],
    group: "plan",
    description: "Calls, meet-ups, sign-up pages and finding a time.",
  },
  {
    id: "notes",
    label: "Files",
    icon: "FolderOpen",
    path: "/notes",
    group: "collect",
    description: "Notes, documents and uploads.",
  },
  {
    id: "databases",
    label: "Databases",
    icon: "Database",
    path: "/databases",
    group: "collect",
    description: "Attendance, sign-ups, votes and reports.",
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: "Plug",
    path: "/integrations",
    also: ["/settings/integrations", "/setup"],
    group: "workspace",
    description: "The apps your organization connects.",
  },
  {
    id: "forms",
    label: "Forms",
    icon: "ClipboardList",
    path: "/forms",
    also: ["/calendar/polls"],
    group: "workspace",
    description: "Quick polls, applications and sign-ups.",
  },
  {
    id: "finance",
    label: "Finance",
    icon: "Wallet",
    path: "/finance",
    group: "workspace",
    description: "Budget, transactions and reimbursements.",
  },
  {
    id: "crm",
    label: "CRM",
    icon: "Handshake",
    path: "/crm",
    group: "workspace",
    description: "People, companies and pipelines you reach out to.",
  },
];

/** The plan feature behind each section (src/lib/billing/features.ts). */
export const SECTION_FEATURES: Record<SectionId, PlanFeature> = {
  overview: "overview",
  inbox: "overview",
  people: "people",
  tasks: "tasks",
  calendar: "rsvp",
  meetings: "rsvp",
  forms: "polls",
  databases: "databases",
  notes: "files",
  integrations: "integrations",
  finance: "finance",
  crm: "crm",
};

/**
 * Sections split out of an older one: a saved sidebar that hid the older
 * one hides these too (RSVP pages were a button on the Calendar).
 */
const ADDED_FROM: Partial<Record<SectionId, SectionId>> = {
  meetings: "calendar",
};

/**
 * A section that was renamed: a saved sidebar naming the old id means the new
 * one, so a club that hid RSVPs still has Meetings hidden, under its own name
 * if they gave it one, and a club that hid Polls has Forms hidden.
 */
const RENAMED_FROM: Partial<Record<SectionId, (typeof RETIRED_SECTION_IDS)[number]>> = {
  meetings: "rsvps",
  forms: "polls",
};

/**
 * Sections that always sit in their own group, in this order, whatever an
 * older saved sidebar says: Files heads Data, and Integrations and apps is
 * Integrations first with each added add-on below it.
 */
export const PINNED_PLACE: readonly SectionId[] = [
  "notes",
  "integrations",
  "forms",
  "finance",
  "crm",
];

/** Groups have no names any more; kept so saved configs and callers still line up. */
export const DEFAULT_GROUP_LABELS: Record<GroupId, string | null> = {
  main: null,
  plan: null,
  collect: null,
  workspace: null,
  money: null,
};

const label = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().max(24, "Keep names under 24 characters."))
  .transform((s) => s || null)
  .nullable();

export const sidebarConfigSchema = z
  .object({
    groups: z
      .array(z.object({ id: z.enum([...GROUP_IDS, ...LEGACY_GROUP_IDS]), label }).strict())
      .max(GROUP_IDS.length + LEGACY_GROUP_IDS.length),
    items: z
      .array(
        z
          .object({
            id: z.enum([...SECTION_IDS, ...RETIRED_SECTION_IDS]),
            group: z.enum([...GROUP_IDS, ...LEGACY_GROUP_IDS]),
            hidden: z.boolean(),
            label,
          })
          .strict(),
      )
      .max(SECTION_IDS.length + RETIRED_SECTION_IDS.length),
  })
  .strict();

export type SidebarConfig = z.output<typeof sidebarConfigSchema>;

export interface ResolvedItem {
  id: SectionId;
  label: string;
  defaultLabel: string;
  icon: string;
  path: string;
  also: string[];
  exact: boolean;
  hidden: boolean;
  locked: boolean;
  group: GroupId;
  description: string;
  /** An add-on the organization hasn't added: hidden, and left out of Admin panel › Sidebar. */
  notAdded?: boolean;
}

export interface ResolvedGroup {
  id: GroupId;
  label: string | null;
  items: ResolvedItem[];
}

/** A saved group, if it is one of today's (older ones are dropped). */
function groupOf(id: string | undefined): GroupId | undefined {
  return (GROUP_IDS as readonly string[]).includes(id ?? "") ? (id as GroupId) : undefined;
}

/**
 * The full sidebar (hidden sections included, flagged), in the org's order.
 * `addOns` is the organization's added add-ons (OrgSettings.addOns); one
 * that isn't added is hidden and marked notAdded. Left out, every add-on
 * counts as added.
 */
export function resolveSidebar(raw: unknown, addOns?: readonly string[] | null): ResolvedGroup[] {
  const parsed = raw ? sidebarConfigSchema.safeParse(raw) : null;
  const config = parsed?.success ? parsed.data : null;
  const saved = new Map<string, NonNullable<typeof config>["items"][number] & { index: number }>(
    config?.items.map((i, index) => [i.id, { ...i, index }]) ?? [],
  );
  const items: (ResolvedItem & { order: number })[] = [];
  for (const [i, def] of SECTIONS.entries()) {
    // A renamed section reads its own saved row first, then the row saved
    // under its old id: a club that hid RSVPs still has Meetings hidden, in
    // the group they put it in, under the name they gave it.
    const renamed = RENAMED_FROM[def.id];
    const s = saved.get(def.id) ?? (renamed ? saved.get(renamed) : undefined);
    // Saved order first. A section added since the club saved its sidebar
    // goes right after the one before it, under its heading (Find a time
    // after Polls, RSVPs after Find a time), and starts hidden if the section
    // it came out of is (Polls, the Calendar).
    const before =
      config && !s && SECTIONS[i - 1]?.group === def.group ? items[items.length - 1] : undefined;
    const from = config && !s ? ADDED_FROM[def.id] : undefined;
    const fromSaved = from ? saved.get(from) : undefined;
    const pinned = PINNED_PLACE.includes(def.id);
    const notAdded = addOns != null && isAddOn(def.id) && !addOns.includes(def.id);
    const group: GroupId = def.locked
      ? "main"
      : pinned
        ? def.group
        : (groupOf(s?.group) ?? before?.group ?? def.group);
    items.push({
      id: def.id,
      label: s?.label ?? def.label,
      defaultLabel: def.label,
      icon: def.icon,
      path: def.path,
      also: def.also ?? [],
      exact: def.exact ?? false,
      hidden: notAdded || (def.locked ? false : (s?.hidden ?? fromSaved?.hidden ?? false)),
      locked: def.locked ?? false,
      group,
      description: def.description,
      ...(notAdded ? { notAdded: true } : {}),
      // Integrations and apps is Integrations, then the add-ons, then
      // anything else an older saved sidebar put there.
      // Files always heads Data; Integrations and apps is Integrations, then
      // the add-ons.
      order:
        def.id === "notes"
          ? -1
          : pinned
            ? 1000 + i
            : group === "workspace"
              ? 2000 + (s ? s.index : i)
              : s
                ? s.index
                : before
                  ? before.order + 0.01
                  : 100 + i,
    });
  }
  // Overview always leads.
  items.sort((a, b) => (a.id === "overview" ? -1 : b.id === "overview" ? 1 : a.order - b.order));
  return GROUP_IDS.map((id) => ({
    id,
    label: null,
    items: items.filter((i) => i.group === id).map(({ order: _o, ...rest }) => rest),
  }));
}

/** What the sidebar shows: hidden sections, add-ons not added and empty groups left out. */
export function visibleSidebar(raw: unknown, addOns?: readonly string[] | null): ResolvedGroup[] {
  return resolveSidebar(raw, addOns)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) }))
    .filter((g) => g.items.length > 0);
}

/**
 * A section's name in the club's sidebar, for its page title (Files may be
 * "Docs"). Find a time (inside Meetings now) keeps its own name; Polls'
 * old pages take the Forms section's.
 */
export function sectionLabel(raw: unknown, id: SectionId | "find-a-time" | "polls"): string {
  if (id === "find-a-time") return "Find a time";
  const key: SectionId = id === "polls" ? "forms" : id;
  const item = resolveSidebar(raw)
    .flatMap((g) => g.items)
    .find((i) => i.id === key);
  return item?.label ?? SECTIONS.find((s) => s.id === key)!.label;
}

export function hiddenSectionPaths(raw: unknown): string[] {
  return resolveSidebar(raw)
    .flatMap((g) => g.items)
    .filter((i) => i.hidden)
    .flatMap((i) => [i.path, ...i.also]);
}

/** The config that reproduces `groups` (what Settings › Sidebar saves). */
export function toConfig(groups: readonly ResolvedGroup[]): SidebarConfig {
  return {
    groups: groups.map((g) => ({ id: g.id, label: null })),
    items: groups.flatMap((g) =>
      g.items.map((i) => ({
        id: i.id,
        group: g.id,
        hidden: i.hidden,
        label: i.label === i.defaultLabel ? null : i.label,
      })),
    ),
  };
}
