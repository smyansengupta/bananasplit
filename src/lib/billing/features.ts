import type { OrgKind, OrgPlan } from "@/generated/prisma/enums";

/**
 * The four plans (redesign guide 11.1; docs/features/personal-and-clubs.md):
 * what each includes and its limits, the one place both live. The pricing
 * table, checkout and Settings › Plan and storage read from here; the app
 * itself asks spaceIncludes() and spaceLimits() (src/lib/billing/space.ts),
 * which also know trials and paused clubs. Change the pricing table with
 * this.
 *
 *   FREE           Personal Free: every account's own space. RSVP pages,
 *                  tasks (every view, for one person), the calendar,
 *                  availability polls, notes and files, databases it makes
 *                  itself, and its own settings.
 *   PERSONAL_PLUS  Personal Plus: Personal Free plus themes, calendar sync
 *                  (data connections, for Google Calendar) and AI imports,
 *                  with more storage, bigger files and longer note history.
 *   CLUB           Team: the club workspace. The overview, weekly updates,
 *                  labels, notes and files, people and the org chart,
 *                  finance, databases (with the built-in ones) and
 *                  reports, and data connections.
 *   SOCIETY        Team Advanced: everything, plus themes, AI,
 *                  sponsorships, website sync and the audit log. A club's
 *                  30-day trial (TRIAL) is Team Advanced, limits included.
 *
 * The plan values keep their database names (FREE, PERSONAL_PLUS, CLUB,
 * SOCIETY, TRIAL); only PLAN_NAMES says them out loud. FREE and
 * PERSONAL_PLUS are Personal's plans and only Personal's; a club is on
 * TRIAL, CLUB or SOCIETY (the database guards both).
 */

/** A plan that has a price and a card (TRIAL is a club's first 30 days of Team Advanced). */
export type PricedPlan = Exclude<OrgPlan, "TRIAL">;

/** The order the four tiers are shown in: the two for one person, then the two for a club. */
export const PLAN_ORDER = [
  "FREE",
  "PERSONAL_PLUS",
  "CLUB",
  "SOCIETY",
] as const satisfies readonly PricedPlan[];

/** The club ladder: a feature names the cheapest rung that has it, and each rung has the ones below. */
const LADDER = ["FREE", "CLUB", "SOCIETY"] as const;
type LadderPlan = (typeof LADDER)[number];

export const PLAN_FEATURES = {
  /** Calendar events and their public RSVP pages, check-in and reminders. */
  rsvp: "FREE",
  /** Tasks. */
  tasks: "FREE",
  /** Board, Week, Table, Roadmap and Dashboard, and the calendar's Tasks layer. */
  taskViews: "FREE",
  /** Availability polls and question polls. */
  polls: "FREE",
  /** Settings: general and the danger zone (a club adds members, invitations and its plan). */
  admin: "FREE",
  /** Live notes, documents and uploads (both Personal plans, and every club). */
  files: "FREE",
  /**
   * Databases and spreadsheets with CSV import. A club also gets the built-in
   * ones (sessions, attendance, sign-ups, votes, people); Personal only the
   * ones it makes (LISTED_DEFINITIONS, src/server/databases/types.ts).
   */
  databases: "FREE",
  /**
   * AI connectors: the member's own AI app (Claude, ChatGPT, Cursor, VS
   * Code) reads and changes what they can see here, over MCP
   * (docs/features/ai-connectors.md). Every plan: the member's app pays for
   * the model, and a club switches it off in Admin panel > Privacy.
   */
  connectors: "FREE",

  /** The Overview board of widgets (Personal has its own home). */
  overview: "CLUB",
  /** Weekly updates: work between people. */
  teamwork: "CLUB",
  /** Shared task labels (Admin panel > Labels). */
  labels: "CLUB",
  /** The member directory, profiles and the org chart. */
  people: "CLUB",
  /** The finance board, budget, transactions and reimbursements. */
  finance: "CLUB",
  /** Reports over the club's databases. */
  reports: "CLUB",
  /** Data connections: Google Calendar sync, an email sender, a data source, guided setup. */
  integrations: "CLUB",
  /** Arranging the sidebar (Admin panel > Sidebar). */
  sidebar: "CLUB",
  /** Ballot privacy, member visibility and the public events feed. */
  privacy: "CLUB",

  /** Custom colors, logo display and the light or dark default. */
  themes: "SOCIETY",
  /** Claude and other AI models: tasks and events from text, sorting data. */
  ai: "SOCIETY",
  /** Sponsorship tracking and runway. */
  sponsorships: "SOCIETY",
  /** Website sync for events and sign-ups (the build hook). */
  websiteSync: "SOCIETY",
  /** Every settings change: who made it and when. */
  auditLog: "SOCIETY",
} as const satisfies Record<string, LadderPlan>;

export type PlanFeature = keyof typeof PLAN_FEATURES;

/**
 * What Personal Plus adds to Personal Free: themes, calendar sync (Google
 * Calendar is a data connection) and AI imports. Nothing else of a club's.
 */
export const PERSONAL_PLUS_EXTRAS = [
  "themes",
  "integrations",
  "ai",
] as const satisfies readonly PlanFeature[];

// ---------------------------------------------------------------- Limits

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface PlanLimits {
  /**
   * Everything the space keeps, in bytes: Notes files (and images in notes),
   * receipts, note history and the trash, until it is emptied
   * (Organization.storageUsedBytes, kept by the database).
   */
  storageBytes: number;
  /** The largest single upload, in bytes. */
  maxFileBytes: number;
  /** How long a note's history (NoteVersion) is kept, in days. */
  noteHistoryDays: number;
  /** Data connections (Google Calendar, an email sender, a data source). */
  dataConnections: number;
  /** Members a space can have: Personal is one person; clubs have no cap. */
  members: number | null;
}

const PERSONAL_FREE_LIMITS: PlanLimits = {
  storageBytes: 1 * GB,
  maxFileBytes: 10 * MB,
  noteHistoryDays: 7,
  dataConnections: 0,
  members: 1,
};
const PERSONAL_PLUS_LIMITS: PlanLimits = {
  storageBytes: 25 * GB,
  maxFileBytes: 250 * MB,
  noteHistoryDays: 365,
  // Calendar sync: one Google Calendar.
  dataConnections: 1,
  members: 1,
};
const TEAM_LIMITS: PlanLimits = {
  storageBytes: 100 * GB,
  maxFileBytes: 250 * MB,
  noteHistoryDays: 90,
  dataConnections: 2,
  members: null,
};
const TEAM_ADVANCED_LIMITS: PlanLimits = {
  storageBytes: 500 * GB,
  maxFileBytes: 1 * GB,
  noteHistoryDays: 365,
  dataConnections: 6,
  members: null,
};

/**
 * Each plan's quantities, enforced by the upload gate
 * (src/server/storage/quota.ts) and shown by the plan cards and the
 * pricing table. A trial has Team Advanced's.
 */
export const PLAN_LIMITS: Record<OrgPlan, PlanLimits> = {
  FREE: PERSONAL_FREE_LIMITS,
  PERSONAL_PLUS: PERSONAL_PLUS_LIMITS,
  TRIAL: TEAM_ADVANCED_LIMITS,
  CLUB: TEAM_LIMITS,
  SOCIETY: TEAM_ADVANCED_LIMITS,
};

// ---------------------------------------------------------------- Names

export const PLAN_NAMES: Record<OrgPlan, string> = {
  FREE: "Personal Free",
  PERSONAL_PLUS: "Personal Plus",
  TRIAL: "Trial",
  CLUB: "Team",
  SOCIETY: "Team Advanced",
};

/** What an owner picks for a club when (or before) its trial ends. */
export const CLUB_PLAN_CHOICES = ["CLUB", "SOCIETY"] as const satisfies readonly PricedPlan[];
export type ClubPlanChoice = (typeof CLUB_PLAN_CHOICES)[number];

/** What a Personal space switches between (the database allows nothing else). */
export const PERSONAL_PLAN_CHOICES = [
  "FREE",
  "PERSONAL_PLUS",
] as const satisfies readonly PricedPlan[];
export type PersonalPlanChoice = (typeof PERSONAL_PLAN_CHOICES)[number];

export function isClubPlanChoice(value: unknown): value is ClubPlanChoice {
  return typeof value === "string" && (CLUB_PLAN_CHOICES as readonly string[]).includes(value);
}

export function isPersonalPlanChoice(value: unknown): value is PersonalPlanChoice {
  return typeof value === "string" && (PERSONAL_PLAN_CHOICES as readonly string[]).includes(value);
}

/** The plans a space of `kind` may be switched to: Personal Free or Plus; Team or Team Advanced. */
export function planChoicesFor(kind: OrgKind): readonly PricedPlan[] {
  return kind === "PERSONAL" ? PERSONAL_PLAN_CHOICES : CLUB_PLAN_CHOICES;
}

/** Whether `plan` is one a space of `kind` may switch to. */
export function isPlanChoiceFor(kind: OrgKind, plan: unknown): plan is PricedPlan {
  return kind === "PERSONAL" ? isPersonalPlanChoice(plan) : isClubPlanChoice(plan);
}

/** A priced plan's name (FREE, PERSONAL_PLUS, CLUB or SOCIETY). */
export function isOrgPlan(value: unknown): value is PricedPlan {
  return typeof value === "string" && (PLAN_ORDER as readonly string[]).includes(value);
}

function rank(plan: LadderPlan): number {
  return LADDER.indexOf(plan);
}

/** Whether `plan` includes `feature` (pricing; the app asks spaceIncludes). */
export function planIncludes(plan: PricedPlan, feature: PlanFeature): boolean {
  if (plan === "PERSONAL_PLUS") {
    return (
      planIncludes("FREE", feature) ||
      (PERSONAL_PLUS_EXTRAS as readonly PlanFeature[]).includes(feature)
    );
  }
  return rank(plan) >= rank(PLAN_FEATURES[feature]);
}

/** The cheapest club plan that includes `feature` (Personal Free for what every space has). */
export function planFor(feature: PlanFeature): LadderPlan {
  return PLAN_FEATURES[feature];
}

/** The Personal plan that includes `feature`, or null when only clubs have it. */
export function personalPlanFor(feature: PlanFeature): PersonalPlanChoice | null {
  if (planIncludes("FREE", feature)) return "FREE";
  return planIncludes("PERSONAL_PLUS", feature) ? "PERSONAL_PLUS" : null;
}

/** Every feature `plan` includes. */
export function featuresOf(plan: PricedPlan): PlanFeature[] {
  return (Object.keys(PLAN_FEATURES) as PlanFeature[]).filter((f) => planIncludes(plan, f));
}

/** What a locked feature is called on the upgrade screen ("Finance comes with the Team plan"). */
export const FEATURE_LABELS: Record<PlanFeature, string> = {
  rsvp: "RSVP pages",
  tasks: "Tasks",
  taskViews: "Board, Week, Table, Roadmap and Dashboard views",
  polls: "Polls",
  admin: "Settings",
  overview: "The Overview",
  teamwork: "Weekly updates",
  labels: "Tags",
  files: "Notes and files",
  people: "People and the org chart",
  finance: "Finance",
  databases: "Databases",
  connectors: "AI connectors",
  reports: "Reports",
  integrations: "Data connections",
  sidebar: "Arranging the sidebar",
  privacy: "Privacy settings",
  themes: "Custom themes",
  ai: "AI",
  sponsorships: "Sponsorship tracking",
  websiteSync: "Website sync",
  auditLog: "The audit log",
};

/** Labels that read as plural ("Notes and files are ..."). */
const PLURAL_FEATURES: ReadonlySet<PlanFeature> = new Set([
  "taskViews",
  "teamwork",
  "files",
  "connectors",
]);

/** Whether a feature's label takes "are" rather than "is". */
export function isPluralFeature(feature: PlanFeature): boolean {
  return PLURAL_FEATURES.has(feature);
}

/** One line on what the feature does, under the upgrade screen's title. */
export const FEATURE_PITCH: Record<PlanFeature, string> = {
  rsvp: "Event pages with sign-ups, waitlists, reminders and check-in.",
  tasks: "A list of what needs doing, and by when.",
  taskViews: "Move work along on a board, plan the week and bulk-edit in a table.",
  polls: "Find a time that works for everyone, or ask anything.",
  admin: "Your name, time zone and the rest of your settings.",
  overview: "Each member's home page: their tasks, meetings, pins and recent pages.",
  teamwork: "Post a weekly update to your team, on the day your club picks.",
  labels: "A shared label palette for sorting tasks.",
  files: "Live notes, documents and uploads in one place.",
  people: "A member directory with profiles, and an org chart for your officers.",
  finance: "A budget, transactions and reimbursements your treasurer can run.",
  databases: "Attendance, sign-ups and votes, with CSV import.",
  connectors: "Use your Personal space and clubs from Claude, ChatGPT and other AI apps.",
  reports: "Charts and summaries from your club's databases.",
  integrations: "Google Calendar sync, your own email sender and your website's data.",
  sidebar: "Choose which sections your club uses, their order and their names.",
  privacy: "Ballot privacy, who sees member emails, and the public events feed.",
  themes: "Your colors and logo across the app.",
  ai: "Turn notes into tasks and events, and let AI sort your data.",
  sponsorships: "Track sponsors, what they promised and your runway.",
  websiteSync: "Publish events and sign-ups to your club website.",
  auditLog: "Every settings change: who made it and when.",
};
