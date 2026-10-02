import { SETTINGS_SECTIONS } from "@/app/app/[orgSlug]/settings/settings-nav";
import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/lib/auth/permissions";
import type { SectionId } from "@/lib/nav/sidebar";
import { scoreFields, type ParsedQuery } from "@/lib/search/text";

/**
 * Everything in the ⌘K palette that isn't a record: the pages of the app
 * (sections, views, settings) and things to do (new note, find a time, pin
 * something, switch theme or org). Matched in the browser as you type, so
 * "budget" or "dark mode" answers before the server search does.
 *
 * What a member can't use is left out: settings pages their role can't open,
 * owner-and-treasurer finance pages, and sections the org hid (Settings ›
 * Sidebar) unless they're an owner or admin. Pure, apart from the role table.
 */

export type PaletteCommand =
  | { type: "href"; href: string }
  | { type: "pin" }
  | { type: "new-note" }
  | { type: "theme"; theme: "light" | "dark" | "system" };

export interface CatalogEntry {
  key: string;
  group: "pages" | "actions";
  title: string;
  detail?: string;
  /** Other words people use for it ("kanban", "dark mode"). */
  keywords: readonly string[];
  /** A lucide icon name (palette-icons.ts). */
  icon: string;
  command: PaletteCommand;
}

export interface PaletteSection {
  id: SectionId;
  /** The org's name for it (Settings › Sidebar). */
  label: string;
  defaultLabel: string;
  path: string;
  hidden: boolean;
  icon: string;
  description: string;
}

export interface CatalogInput {
  orgSlug: string;
  role: Role | null;
  sections: readonly PaletteSection[];
  orgs?: readonly { slug: string; name: string; pendingDeletion?: boolean }[];
  /** The org fixes light or dark (Settings › Theme): no theme switching. */
  themeLocked?: boolean;
  /** "Pin something" is available. */
  canPin?: boolean;
}

interface PageDef {
  path: string;
  title: string;
  icon: string;
  keywords: readonly string[];
  section?: SectionId;
  permission?: Permission;
  detail?: string;
}

const PAGES: readonly PageDef[] = [
  // Tasks
  {
    path: "/tasks?view=week&scope=mine",
    title: "My week",
    section: "tasks",
    icon: "CalendarRange",
    keywords: ["my tasks", "due", "this week", "todo", "assigned to me", "mine"],
  },
  {
    path: "/tasks?view=board",
    title: "Task board",
    section: "tasks",
    icon: "Columns3",
    keywords: ["kanban", "columns", "status"],
  },
  {
    path: "/tasks?view=table",
    title: "Task table",
    section: "tasks",
    icon: "Table",
    keywords: ["list", "spreadsheet", "bulk edit", "filter"],
  },
  {
    path: "/tasks?view=calendar",
    title: "Task calendar",
    section: "tasks",
    icon: "CalendarDays",
    keywords: ["due dates", "month", "deadlines"],
  },
  {
    path: "/tasks?view=team",
    title: "Team workload",
    section: "tasks",
    icon: "Users",
    keywords: ["lanes", "people", "who is doing what", "team"],
  },
  {
    path: "/tasks?view=updates",
    title: "Sunday update",
    section: "tasks",
    icon: "Newspaper",
    keywords: ["weekly update", "status report", "summary"],
  },
  {
    path: "/tasks?view=intake",
    title: "Requests",
    section: "tasks",
    icon: "Inbox",
    keywords: ["intake", "design requests", "queue", "triage"],
  },
  // Calendar
  {
    path: "/calendar/sync",
    title: "Calendar sync",
    section: "calendar",
    permission: "integrations.view",
    icon: "CalendarSync",
    keywords: ["google calendar", "mirror"],
  },
  // Notes
  {
    path: "/notes?tab=files",
    title: "Files",
    section: "notes",
    icon: "Paperclip",
    keywords: ["uploads", "documents", "attachments", "pdf", "docs"],
  },
  {
    path: "/notes?folder=trash",
    title: "Recently deleted",
    section: "notes",
    icon: "Trash2",
    keywords: ["trash", "restore", "deleted", "undo", "bin"],
  },
  // You
  {
    path: "/profile",
    title: "Your profile",
    icon: "UserRound",
    keywords: [
      "account",
      "me",
      "bio",
      "photo",
      "avatar",
      "pronouns",
      "major",
      "availability",
      "links",
    ],
  },
  // Org chart
  {
    path: "/org-chart/versions",
    title: "Org chart history",
    section: "org-chart",
    icon: "History",
    keywords: ["versions", "past", "published"],
  },
  {
    path: "/org-chart/import",
    title: "Import org chart",
    section: "org-chart",
    permission: "orgchart.write",
    icon: "Upload",
    keywords: ["upload", "constitution", "bylaws", "roles"],
  },
  // Databases
  {
    path: "/databases/reports",
    title: "Reports",
    section: "databases",
    icon: "ChartColumn",
    keywords: ["analytics", "charts", "stats", "attendance", "trends", "insights"],
  },
  // Finance
  {
    path: "/finance/transactions",
    title: "Transactions",
    section: "finance",
    permission: "finance.manage",
    icon: "ArrowLeftRight",
    keywords: ["ledger", "expenses", "income", "money", "spending"],
  },
  {
    path: "/finance/budget",
    title: "Budget",
    section: "finance",
    permission: "finance.manage",
    icon: "PiggyBank",
    keywords: ["categories", "allocation", "spending", "money"],
  },
  {
    path: "/finance/sponsorships",
    title: "Sponsorships",
    section: "finance",
    permission: "finance.manage",
    icon: "Handshake",
    keywords: ["sponsors", "partners", "funding"],
  },
  {
    path: "/finance/my-reimbursements",
    title: "My reimbursements",
    section: "finance",
    icon: "Receipt",
    keywords: ["expense", "receipt", "pay me back", "reimburse", "money owed"],
  },
  {
    path: "/finance/import",
    title: "Import past records",
    section: "finance",
    permission: "finance.manage",
    icon: "FileUp",
    keywords: ["csv", "spreadsheet", "history", "upload"],
  },
  {
    path: "/finance/setup",
    title: "Finance setup",
    section: "finance",
    permission: "finance.manage",
    icon: "Settings2",
    keywords: ["treasurer", "get started", "periods"],
  },
  // Setup
  {
    path: "/setup",
    title: "Club setup",
    permission: "integrations.write",
    icon: "Rocket",
    keywords: ["getting started", "onboarding", "checklist"],
  },
  {
    path: "/setup/status",
    title: "Setup status",
    permission: "integrations.write",
    icon: "ListChecks",
    keywords: ["getting started", "progress", "checklist"],
  },
  // Settings (the sections come from settings-nav, below)
  {
    path: "/settings",
    title: "Settings",
    icon: "Settings",
    keywords: ["preferences", "configuration", "admin", "options"],
  },
  {
    path: "/settings/invitations",
    title: "Invitations",
    permission: "members.invite",
    icon: "MailPlus",
    keywords: ["invite", "join code", "link", "add members"],
    detail: "Settings",
  },
  {
    path: "/settings/integrations/email",
    title: "Email sender",
    permission: "integrations.view",
    icon: "Mail",
    keywords: ["resend", "domain", "mail", "integrations"],
    detail: "Settings · Integrations",
  },
  {
    path: "/settings/integrations/claude",
    title: "Claude",
    permission: "integrations.view",
    icon: "Sparkles",
    keywords: ["ai", "anthropic", "api key", "integrations"],
    detail: "Settings · Integrations",
  },
  {
    path: "/settings/integrations/ai-model",
    title: "AI model",
    permission: "integrations.view",
    icon: "Sparkles",
    keywords: ["claude", "model", "ai", "integrations"],
    detail: "Settings · Integrations",
  },
  {
    path: "/settings/integrations/google-calendar",
    title: "Google Calendar",
    permission: "integrations.view",
    icon: "CalendarSync",
    keywords: ["gcal", "sync", "integrations"],
    detail: "Settings · Integrations",
  },
  {
    path: "/settings/integrations/website",
    title: "Website",
    permission: "integrations.view",
    icon: "Globe",
    keywords: ["build hook", "public events", "site", "integrations"],
    detail: "Settings · Integrations",
  },
  {
    path: "/settings/integrations/data-source",
    title: "Website data",
    permission: "integrations.view",
    icon: "DatabaseZap",
    keywords: ["supabase", "sync", "attendance", "integrations"],
    detail: "Settings · Integrations",
  },
];

/** Other words for each settings page (settings-nav has the names and permissions). */
const SETTINGS_KEYWORDS: Record<string, readonly string[]> = {
  general: ["club name", "url", "slug", "timezone", "picture", "logo"],
  sidebar: ["sections", "navigation", "hide", "rename", "menu", "order"],
  theme: ["colors", "branding", "logo", "dark mode", "light mode", "appearance"],
  labels: ["tags", "task labels"],
  members: ["roster", "roles", "titles", "invite", "remove", "admins"],
  privacy: ["ballots", "emails", "visibility", "public"],
  integrations: ["connections", "api", "apps"],
  notifications: ["email", "alerts", "digest", "unsubscribe"],
  calendar: ["ics", "subscribe", "feed", "apple calendar", "outlook"],
  audit: ["log", "history", "changes"],
  danger: ["delete", "export", "backup", "download data"],
};

function sectionVisible(input: CatalogInput, section: SectionId | undefined): boolean {
  if (!section) return true;
  const found = input.sections.find((s) => s.id === section);
  return !found?.hidden || can({ role: input.role }, "settings.view");
}

export function buildCatalog(input: CatalogInput): CatalogEntry[] {
  const base = `/app/${input.orgSlug}`;
  const allowed = (permission?: Permission) => !permission || can({ role: input.role }, permission);
  const sectionLabel = (id?: SectionId) => input.sections.find((s) => s.id === id)?.label;
  const entries: CatalogEntry[] = [];

  // The sidebar's sections, under the org's names.
  for (const s of input.sections) {
    if (!sectionVisible(input, s.id)) continue;
    entries.push({
      key: `page:section:${s.id}`,
      group: "pages",
      title: s.label,
      detail: s.hidden ? `${s.description} Hidden from members.` : s.description,
      keywords: s.label === s.defaultLabel ? [] : [s.defaultLabel],
      icon: s.icon,
      command: { type: "href", href: `${base}${s.path}` },
    });
  }

  for (const page of PAGES) {
    if (!allowed(page.permission) || !sectionVisible(input, page.section)) continue;
    entries.push({
      key: `page:${page.path}`,
      group: "pages",
      title: page.title,
      detail: page.detail ?? sectionLabel(page.section),
      keywords: page.keywords,
      icon: page.icon,
      command: { type: "href", href: `${base}${page.path}` },
    });
  }

  for (const s of SETTINGS_SECTIONS) {
    if (!allowed(s.permission)) continue;
    entries.push({
      key: `page:/settings/${s.segment}`,
      group: "pages",
      title: s.label,
      detail: `Settings · ${s.description}`,
      keywords: SETTINGS_KEYWORDS[s.segment] ?? [],
      icon: s.icon,
      command: { type: "href", href: `${base}/settings/${s.segment}` },
    });
  }

  // Things to do.
  const action = (entry: Omit<CatalogEntry, "group">, section?: SectionId) => {
    if (sectionVisible(input, section)) entries.push({ ...entry, group: "actions" });
  };
  action(
    {
      key: "action:new-note",
      title: "New note",
      detail: "Start a private note",
      keywords: ["create", "write", "document", "add"],
      icon: "SquarePen",
      command: { type: "new-note" },
    },
    "notes",
  );
  action(
    {
      key: "action:new-poll",
      title: "Find a time",
      detail: "Ask people when they're free",
      keywords: [
        "new poll",
        "create poll",
        "schedule",
        "availability",
        "meeting time",
        "when2meet",
      ],
      icon: "CalendarPlus",
      command: { type: "href", href: `${base}/calendar/polls/new` },
    },
    "polls",
  );
  action(
    {
      key: "action:ask",
      title: "Ask the club a question",
      detail: "A quick vote",
      keywords: ["new poll", "create poll", "vote", "survey", "question"],
      icon: "MessageCircleQuestion",
      command: { type: "href", href: `${base}/calendar/polls/ask` },
    },
    "polls",
  );
  action(
    {
      key: "action:expense",
      title: "Submit an expense",
      detail: "Get paid back for club spending",
      keywords: ["reimbursement", "receipt", "new expense", "pay me back"],
      icon: "Receipt",
      command: { type: "href", href: `${base}/finance/my-reimbursements` },
    },
    "finance",
  );
  if (input.canPin) {
    action({
      key: "action:pin",
      title: "Pin something…",
      detail: "Keep it in your sidebar and on your Overview",
      keywords: ["pin", "favorite", "bookmark", "sidebar", "shortcut"],
      icon: "Pin",
      command: { type: "pin" },
    });
  }
  if (!input.themeLocked) {
    const theme = ["theme", "appearance", "mode", "color scheme"];
    action({
      key: "action:theme-dark",
      title: "Use dark theme",
      keywords: [...theme, "dark mode", "night"],
      icon: "Moon",
      command: { type: "theme", theme: "dark" },
    });
    action({
      key: "action:theme-light",
      title: "Use light theme",
      keywords: [...theme, "light mode", "day"],
      icon: "Sun",
      command: { type: "theme", theme: "light" },
    });
    action({
      key: "action:theme-system",
      title: "Match system theme",
      keywords: [...theme, "auto", "os", "device"],
      icon: "Monitor",
      command: { type: "theme", theme: "system" },
    });
  }
  for (const org of input.orgs ?? []) {
    if (org.slug === input.orgSlug || org.pendingDeletion) continue;
    action({
      key: `action:org:${org.slug}`,
      title: `Switch to ${org.name}`,
      detail: "Organization",
      keywords: ["switch", "organization", "club", "org"],
      icon: "ArrowRightLeft",
      command: { type: "href", href: `/app/${org.slug}` },
    });
  }
  return entries;
}

export interface CatalogHit {
  entry: CatalogEntry;
  score: number;
}

/** The entries matching every word of `q`, best first. */
export function matchCatalog(entries: readonly CatalogEntry[], q: ParsedQuery): CatalogHit[] {
  if (!q.folded.length) return [];
  return entries
    .map((entry, i) => ({
      entry,
      i,
      score: scoreFields(
        [
          { text: entry.title, weight: 3 },
          { text: entry.keywords.join(" · "), weight: 1.5 },
          { text: entry.detail, weight: 0.5 },
        ],
        q,
        { requireAll: true },
      ),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ entry, score }) => ({ entry, score }));
}
