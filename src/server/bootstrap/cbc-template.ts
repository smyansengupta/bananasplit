import { TZDate } from "@date-fns/tz";
import { generateNKeysBetween } from "fractional-indexing";

import {
  AttendanceMethod,
  EventKind,
  EventVisibility,
  OrgChartSource,
  Prisma,
  RecordSource,
  Role,
  SignupSource,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
  ThemeMode,
  type AssignmentRelation,
} from "@/generated/prisma/client";
import { fromDateKey, localDateKey } from "@/lib/tasks/dates";

/**
 * The Claude Builders Club workspace: the one source of the CBC structure
 * (spec 'Seed data: Claude Builders Club (Fall 2026)').
 *
 * - applyCbcTemplate(): production-safe workspace setup. Used by the
 *   OWNER-only 'Bootstrap CBC workspace' action (inside withOrgAction, so it
 *   runs as app_user under RLS as that OWNER) and by prisma/seed.ts. It sets
 *   the task defaults, creates the 'Needs President' and 'Design' labels,
 *   the Design Requests intake project and the published org chart (9
 *   positions: Mehr as advisor, the Graphic Designer as an open hire), sets
 *   member titles and the CBC theme preset. It creates no Membership rows
 *   and touches no other org.
 * - seedCbcDemoData(): seed only (previews, CI, local). Sessions, synthetic
 *   contacts with attendance, signups and ballots, tasks, Sunday updates,
 *   notes and a budget. Refuses to run in production. Uses a seeded PRNG,
 *   so every run produces the same data relative to the current week.
 *
 * Both take a Prisma client or transaction client and the org id; neither
 * does network I/O.
 */

type Db = Prisma.TransactionClient;

export const CBC_TIMEZONE = "America/New_York";

export const CBC_ORG = {
  name: "Claude Builders Club",
  slug: "claude-builders-club",
  timezone: CBC_TIMEZONE,
} as const;

export type CbcPersonKey =
  "jackson" | "mehr" | "oliver" | "lucas" | "anthony" | "alex" | "smyan" | "kristine";

export interface CbcPerson {
  key: CbcPersonKey;
  name: string;
  /** Placeholder address; real members sign in with their own accounts. */
  email: string;
  role: Role;
  /** Membership.title in the CBC org. */
  title: string;
  positionKey: string;
  pronouns?: string;
  major?: string;
  gradYear?: number;
}

/** The 8 people (placeholder @example.edu emails). Roles per CONTRACTS.md. */
export const CBC_PEOPLE: readonly CbcPerson[] = [
  {
    key: "jackson",
    name: "Jackson Lamoureux",
    email: "jackson@example.edu",
    role: Role.OWNER,
    title: "President",
    positionKey: "president",
    major: "Computer Science",
    gradYear: 2027,
  },
  {
    key: "mehr",
    name: "Mehr Anand",
    email: "mehr@example.edu",
    role: Role.MEMBER,
    title: "Founder & Advisor",
    positionKey: "founder-advisor",
    major: "Computer Science",
    gradYear: 2026,
  },
  {
    key: "oliver",
    name: "Oliver Ward",
    email: "oliver@example.edu",
    role: Role.ADMIN,
    title: "VP Ops & Programs",
    positionKey: "vp-ops-programs",
    major: "Business Administration",
    gradYear: 2027,
  },
  {
    key: "lucas",
    name: "Lucas Salzgeber",
    email: "lucas@example.edu",
    role: Role.ADMIN,
    title: "VP Growth",
    positionKey: "vp-growth",
    major: "Data Science",
    gradYear: 2028,
  },
  {
    key: "anthony",
    name: "Anthony Jones",
    email: "anthony@example.edu",
    role: Role.TREASURER,
    title: "Head of Finance",
    positionKey: "head-of-finance",
    major: "Finance",
    gradYear: 2027,
  },
  {
    key: "alex",
    name: "Alex Green",
    email: "alex@example.edu",
    role: Role.MEMBER,
    title: "Head of Programs",
    positionKey: "head-of-programs",
    major: "Computer Science",
    gradYear: 2028,
  },
  {
    key: "smyan",
    name: "Smyan Sengupta",
    email: "smyan@example.edu",
    role: Role.MEMBER,
    title: "Head of Tech",
    positionKey: "head-of-tech",
    major: "Computer Engineering",
    gradYear: 2028,
  },
  {
    key: "kristine",
    name: "Kristine Min",
    email: "kristine@example.edu",
    role: Role.MEMBER,
    title: "Head of Social & Membership",
    positionKey: "head-of-social-membership",
    major: "Communication Studies",
    gradYear: 2029,
  },
];

export interface CbcPosition {
  key: string;
  title: string;
  /** The person in the chart; null for the open hire. */
  person: CbcPersonKey | null;
  personName: string | null;
  reportsTo: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
}

/** The published chart: 9 positions, Mehr as advisor, Graphic Designer open. */
export const CBC_POSITIONS: readonly CbcPosition[] = [
  {
    key: "president",
    title: "President",
    person: "jackson",
    personName: "Jackson Lamoureux",
    reportsTo: null,
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Sets semester vision, goals, and priorities for the club",
      "Owns all partnerships: Anthropic, Khoury, faculty advisor, sponsors, guest speakers",
      "Leads funding asks with Anthony",
      "Final say on budget, Anthropic brand use, new partnerships, and board changes",
      "Opens the weekly exec sync and holds biweekly 1:1s with both VPs",
      "Reads Sunday updates and clears blockers the VPs can't solve",
    ],
    decidesAlone: [
      "Budget (final say)",
      "Anthropic brand use",
      "New partnerships",
      "Board changes",
    ],
  },
  {
    key: "founder-advisor",
    title: "Founder & Advisor",
    person: "mehr",
    personName: "Mehr Anand",
    reportsTo: "president",
    isOpen: false,
    isAdvisor: true,
    responsibilities: [
      "Sounding board for Jackson on strategy and tough calls",
      "Answers questions from Jackson as needed",
      "Optional technical input on the ops suite and workshops",
      "Provides continuity from the club's founding",
    ],
    decidesAlone: [],
  },
  {
    key: "vp-ops-programs",
    title: "VP Ops & Programs",
    person: "oliver",
    personName: "Oliver Ward",
    reportsTo: "president",
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Runs the weekly exec sync agenda and owns the task board",
      "Collects Sunday updates from all leads and flags blockers to Jackson",
      "Owns the semester calendar for workshops, hackathon, and events",
      "Makes sure Programs and Tech deliver on time",
      "Keeps shared Drive and Slack organized",
    ],
    decidesAlone: ["Deadlines", "Task assignments", "Internal process"],
  },
  {
    key: "vp-growth",
    title: "VP Growth",
    person: "lucas",
    personName: "Lucas Salzgeber",
    reportsTo: "president",
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Owns member growth, event turnout, and club brand on campus",
      "Builds relationships with other clubs and campus orgs",
      "Manages the designer and sets priority across all design requests",
      "Signs off on brand consistency for posts, flyers, and decks",
      "Leads recruitment for the next board application round",
    ],
    decidesAlone: ["Campus outreach", "Brand calls", "Design priorities"],
  },
  {
    key: "head-of-finance",
    title: "Head of Finance",
    person: "anthony",
    personName: "Anthony Jones",
    reportsTo: "president",
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Keeps the budget tracker and all spending records",
      "Processes reimbursements and purchase requests",
      "Supports funding applications (SAO, Anthropic, Khoury) with Jackson",
      "Sends Jackson a monthly budget report",
    ],
    decidesAlone: ["Approving spend under the set limit"],
  },
  {
    key: "head-of-programs",
    title: "Head of Programs",
    person: "alex",
    personName: "Alex Green",
    reportsTo: "vp-ops-programs",
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Owns the 17-workshop plan: topics, order, dates",
      "Recruits and preps presenters (board, members, guests)",
      "Owns workshop materials: slides, starter repos, handouts",
      "Runs logistics: rooms, food, run-of-show, day-of setup",
      "Sets hackathon tracks, theme, judging, and logistics",
      "Collects feedback after each session and improves the next one",
    ],
    decidesAlone: [],
  },
  {
    key: "head-of-tech",
    title: "Head of Tech",
    person: "smyan",
    personName: "Smyan Sengupta",
    reportsTo: "vp-ops-programs",
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Builds and maintains the internal ops suite",
      "Owns claudeneu.com and all site updates",
      "Owns the check-in system, attendance data, and stamp-card rewards",
      "Gives member data to Kristine for outreach",
      "Technical QA on workshop materials and starter code",
      "Hands off current partnership contacts and threads to Jackson",
    ],
    decidesAlone: [],
  },
  {
    key: "head-of-social-membership",
    title: "Head of Social & Membership",
    person: "kristine",
    personName: "Kristine Min",
    reportsTo: "vp-growth",
    isOpen: false,
    isAdvisor: false,
    responsibilities: [
      "Owns the content calendar across Instagram and TikTok",
      "Promotes every workshop and event",
      "Sends the new-member welcome and Slack invite",
      "Runs the newsletter and keeps Slack active between events",
      "Uses attendance data from Smyan to re-engage inactive members",
      "Sends design requests through the intake queue",
    ],
    decidesAlone: [],
  },
  {
    key: "graphic-designer",
    title: "Graphic Designer",
    person: null,
    personName: null,
    reportsTo: "vp-growth",
    isOpen: true,
    isAdvisor: false,
    responsibilities: [
      "Builds and maintains the brand kit: colors, fonts, templates",
      "Designs flyers, social graphics, and event visuals",
      "Makes slide templates for workshops and partner decks",
      "Works only from the intake queue, no DM requests",
      "Turns requests around within an agreed window (3 to 5 days)",
    ],
    decidesAlone: [],
  },
];

/** 'How we work': the chart's open items. */
export const CBC_OPEN_ITEMS = [
  { who: "Lucas Salzgeber", question: "When does the Graphic Designer hiring round open?" },
  {
    who: "Anthony Jones",
    question: "What is the spend limit above which purchases need the President?",
  },
];

export const CBC_LABELS = {
  needsPresident: {
    name: "Needs President",
    color: "#dc2626",
    /** Anthropic brand use, spend over the limit, new partnerships, board changes. */
  },
  design: { name: "Design", color: "#9333ea" },
} as const;

export const CBC_INTAKE_PROJECT = {
  name: "Design Requests",
  description:
    "Intake queue for flyers, social graphics, slides and event visuals. File a request here, never by DM. " +
    "The VP Growth sets priority; the designer turns requests around in 3 to 5 days.",
  triagePositionKey: "vp-growth",
  triagePerson: "lucas" as CbcPersonKey,
  defaultDueInDays: 5,
};

/** The Claude Builders Club theme preset (Phase 8 scope). Strict hex only. */
export const CBC_THEME = {
  preset: "cbc",
  mode: ThemeMode.SYSTEM,
  light: {
    primary: "#a34a2a",
    accent: "#d97757",
    background: "#faf9f5",
    surface: "#ffffff",
    text: "#141413",
  },
  dark: {
    primary: "#d97757",
    accent: "#e39a7a",
    background: "#141413",
    surface: "#1f1e1b",
    text: "#f7f5ef",
  },
} as const;

export interface ApplyCbcTemplateOptions {
  organizationId: string;
  /** The OWNER running the bootstrap (or the seed's president). */
  actorId: string;
  /** Members matched to the CBC people, by key. Unmatched people stay placeholders. */
  members: Partial<Record<CbcPersonKey, string>>;
  /** Chart version source: SEED from the seed, MANUAL from the action. */
  source?: OrgChartSource;
  /** Also set Membership.title for matched members. */
  setTitles?: boolean;
  now?: Date;
}

export interface ApplyCbcTemplateResult {
  chartVersionId: string;
  intakeProjectId: string;
  labelIds: { needsPresident: string; design: string };
}

/**
 * Applies the CBC workspace to an org. Idempotent enough to re-run: labels
 * and the intake project are reused by name, and the chart is appended as a
 * new published version (history is append-only), archiving the previous
 * one. Runs every write through `db`, so under withOrgAction the OWNER's RLS
 * policies apply.
 */
export async function applyCbcTemplate(
  db: Db,
  opts: ApplyCbcTemplateOptions,
): Promise<ApplyCbcTemplateResult> {
  const { organizationId, actorId, members } = opts;
  const now = opts.now ?? new Date();

  // Task defaults from 'How we work': every task has one owner and a due date.
  await db.orgSettings.update({
    where: { organizationId },
    data: {
      taskRequireOwner: true,
      taskRequireDueDate: true,
      reminderLeadDaysDefault: 1,
      bootstrapTemplate: "cbc",
      bootstrappedAt: now,
      updatedById: actorId,
    },
  });

  // Labels.
  const labelIds = {} as { needsPresident: string; design: string };
  for (const [key, def] of Object.entries(CBC_LABELS) as [
    keyof typeof CBC_LABELS,
    { name: string; color: string },
  ][]) {
    const existing = await db.label.findFirst({
      where: { organizationId, name: def.name },
      select: { id: true },
    });
    labelIds[key] =
      existing?.id ??
      (
        await db.label.create({
          data: { organizationId, name: def.name, color: def.color },
          select: { id: true },
        })
      ).id;
  }

  // Design Requests intake project, triaged by the VP Growth.
  const triageUserId = members[CBC_INTAKE_PROJECT.triagePerson] ?? null;
  const existingProject = await db.project.findFirst({
    where: { organizationId, name: CBC_INTAKE_PROJECT.name },
    select: { id: true },
  });
  const projectData = {
    description: CBC_INTAKE_PROJECT.description,
    isIntake: true,
    triageUserId,
    triagePositionKey: CBC_INTAKE_PROJECT.triagePositionKey,
    defaultDueInDays: CBC_INTAKE_PROJECT.defaultDueInDays,
  };
  const intakeProjectId = existingProject
    ? (
        await db.project.update({
          where: { id: existingProject.id },
          data: projectData,
          select: { id: true },
        })
      ).id
    : (
        await db.project.create({
          data: { organizationId, name: CBC_INTAKE_PROJECT.name, ...projectData },
          select: { id: true },
        })
      ).id;

  // Org chart: a new published version with the 9 positions.
  const last = await db.orgChartVersion.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  await db.orgChartVersion.updateMany({
    where: { organizationId, status: "PUBLISHED" },
    data: { status: "ARCHIVED" },
  });
  const version = await db.orgChartVersion.create({
    data: {
      organizationId,
      number: (last?.number ?? 0) + 1,
      status: "PUBLISHED",
      source: opts.source ?? OrgChartSource.MANUAL,
      openItems: CBC_OPEN_ITEMS,
      createdById: actorId,
      publishedById: actorId,
      publishedAt: now,
    },
    select: { id: true },
  });

  const idsByKey = new Map<string, string>();
  const siblingRanks = new Map<string | null, string[]>();
  for (const parent of new Set(CBC_POSITIONS.map((p) => p.reportsTo))) {
    const count = CBC_POSITIONS.filter((p) => p.reportsTo === parent).length;
    siblingRanks.set(parent, generateNKeysBetween(null, null, count));
  }
  const rankCursor = new Map<string | null, number>();
  // CBC_POSITIONS lists every parent before its reports.
  for (const p of CBC_POSITIONS) {
    const i = rankCursor.get(p.reportsTo) ?? 0;
    rankCursor.set(p.reportsTo, i + 1);
    const userId = p.person ? (members[p.person] ?? null) : null;
    const created = await db.orgChartPosition.create({
      data: {
        organizationId,
        versionId: version.id,
        key: p.key,
        title: p.title,
        personName: p.personName,
        userId,
        matchState: userId ? "CONFIRMED" : "UNMATCHED",
        matchScore: userId ? 1 : null,
        reportsToId: p.reportsTo ? (idsByKey.get(p.reportsTo) ?? null) : null,
        isOpen: p.isOpen,
        isAdvisor: p.isAdvisor,
        responsibilities: p.responsibilities,
        decidesAlone: p.decidesAlone,
        rank: siblingRanks.get(p.reportsTo)![i],
      },
      select: { id: true },
    });
    idsByKey.set(p.key, created.id);
  }
  await db.organization.update({
    where: { id: organizationId },
    data: { activeOrgChartVersionId: version.id },
  });

  // Per-org titles (separate from the permission role).
  if (opts.setTitles !== false) {
    for (const person of CBC_PEOPLE) {
      const userId = members[person.key];
      if (!userId) continue;
      await db.membership.updateMany({
        where: { organizationId, userId },
        data: { title: person.title },
      });
    }
  }

  // Theme preset.
  await db.orgTheme.upsert({
    where: { organizationId },
    create: {
      organizationId,
      preset: CBC_THEME.preset,
      mode: CBC_THEME.mode,
      light: CBC_THEME.light,
      dark: CBC_THEME.dark,
      updatedById: actorId,
    },
    update: {
      preset: CBC_THEME.preset,
      mode: CBC_THEME.mode,
      light: CBC_THEME.light,
      dark: CBC_THEME.dark,
      updatedById: actorId,
    },
  });

  return { chartVersionId: version.id, intakeProjectId, labelIds };
}

// ===========================================================================
// Seed-only demo data
// ===========================================================================

/** Deterministic PRNG (mulberry32), so the seed is reproducible without faker. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    sample: <T>(items: readonly T[], n: number): T[] => {
      const copy = [...items];
      const out: T[] = [];
      while (out.length < n && copy.length)
        out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
  };
}

type Rng = ReturnType<typeof createRng>;

/** A wall-clock time in the CBC timezone, `weekOffset` weeks from this week's Monday. */
function cbcTime(
  monday: TZDate,
  weekOffset: number,
  dayOfWeek: number,
  hour: number,
  minute = 0,
): Date {
  const d = new TZDate(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + weekOffset * 7 + dayOfWeek,
    hour,
    minute,
    0,
    CBC_TIMEZONE,
  );
  return new Date(d.getTime());
}

function mondayOf(now: Date): TZDate {
  const local = new TZDate(now.getTime(), CBC_TIMEZONE);
  const daysSinceMonday = (local.getDay() + 6) % 7;
  return new TZDate(
    local.getFullYear(),
    local.getMonth(),
    local.getDate() - daysSinceMonday,
    0,
    0,
    0,
    CBC_TIMEZONE,
  );
}

interface SessionPlan {
  week: number;
  /** 0 = Monday. */
  day: number;
  hour: number;
  minutes: number;
  title: string;
  kind: EventKind;
  visibility: EventVisibility;
  location: string;
  host?: CbcPersonKey;
  hostName?: string;
  stampSlot?: number;
  description?: string;
  featured?: boolean;
}

/**
 * The semester, relative to the current week (week 0). Workshops are public
 * and count toward the stamp card; the exec sync is internal.
 */
export const CBC_SESSION_PLAN: readonly SessionPlan[] = [
  {
    week: -3,
    day: 1,
    hour: 18,
    minutes: 60,
    title: "Info Session: Meet the Claude Builders Club",
    kind: EventKind.INFO_SESSION,
    visibility: EventVisibility.PUBLIC,
    location: "Curry Student Center 344",
    host: "jackson",
    featured: true,
    description: "What we build, how the stamp card works, and how to get involved this semester.",
  },
  {
    week: -3,
    day: 3,
    hour: 18,
    minutes: 90,
    title: "Workshop 1: Prompting Fundamentals",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "alex",
    stampSlot: 1,
  },
  {
    week: -3,
    day: 5,
    hour: 14,
    minutes: 120,
    title: "Welcome Social: Board Games & Boba",
    kind: EventKind.SOCIAL,
    visibility: EventVisibility.PUBLIC,
    location: "Curry Student Center Ballroom",
    host: "kristine",
  },
  {
    week: -2,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 2: Building with the Claude API",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "smyan",
    stampSlot: 2,
  },
  {
    week: -2,
    day: 3,
    hour: 18,
    minutes: 90,
    title: "Workshop 3: Tool Use and Function Calling",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "alex",
    stampSlot: 3,
  },
  {
    week: -1,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 4: Retrieval-Augmented Generation",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "Richards Hall 300",
    host: "alex",
    stampSlot: 4,
  },
  {
    week: -1,
    day: 3,
    hour: 18,
    minutes: 90,
    title: "Workshop 5: Evals That Catch Regressions",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "Richards Hall 300",
    hostName: "Guest speaker (industry)",
    stampSlot: 5,
  },
  {
    week: 0,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 6: Agents with the Claude Agent SDK",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "smyan",
    stampSlot: 6,
    featured: true,
  },
  {
    week: 0,
    day: 3,
    hour: 18,
    minutes: 90,
    title: "Workshop 7: Claude Code for Your Projects",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "alex",
    stampSlot: 7,
  },
  {
    week: 1,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 8: Vision and PDFs",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "Richards Hall 300",
    host: "alex",
    stampSlot: 8,
  },
  {
    week: 1,
    day: 4,
    hour: 19,
    minutes: 120,
    title: "Fall Social: Pizza & Project Demos",
    kind: EventKind.SOCIAL,
    visibility: EventVisibility.PUBLIC,
    location: "Curry Student Center 344",
    host: "kristine",
  },
  {
    week: 2,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 9: Structured Outputs",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    hostName: "Guest speaker (Anthropic)",
    stampSlot: 9,
  },
  {
    week: 2,
    day: 3,
    hour: 18,
    minutes: 90,
    title: "Workshop 10: MCP Servers from Scratch",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "smyan",
    stampSlot: 10,
  },
  {
    week: 3,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 11: Prompt Caching and Cost Control",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "Richards Hall 300",
    host: "alex",
    stampSlot: 11,
  },
  {
    week: 3,
    day: 3,
    hour: 18,
    minutes: 60,
    title: "Info Session: Spring Board Applications",
    kind: EventKind.INFO_SESSION,
    visibility: EventVisibility.PUBLIC,
    location: "Curry Student Center 344",
    host: "lucas",
  },
  {
    week: 4,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 12: Building a RAG Chatbot",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "alex",
    stampSlot: 12,
  },
  {
    week: 5,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 13: Safety and Red-Teaming",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "alex",
  },
  {
    week: 6,
    day: 5,
    hour: 10,
    minutes: 720,
    title: "Claude Builders Hackathon",
    kind: EventKind.HACKATHON,
    visibility: EventVisibility.PUBLIC,
    location: "ISEC Atrium",
    host: "oliver",
    featured: true,
    description: "Twelve hours, three tracks, prizes for the best builds. Teams of up to four.",
  },
  {
    week: 7,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 14: Shipping to Production",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "Richards Hall 300",
    host: "smyan",
  },
  {
    week: 8,
    day: 1,
    hour: 18,
    minutes: 90,
    title: "Workshop 15: Demo Night Prep",
    kind: EventKind.WORKSHOP,
    visibility: EventVisibility.PUBLIC,
    location: "West Village H 110",
    host: "alex",
  },
];

/** The weekly 30-minute exec sync (blockers only), run by the VP Ops & Programs. */
const EXEC_SYNC = { day: 0, hour: 19, minutes: 30, fromWeek: -3, toWeek: 8 };

const FIRST_NAMES = [
  "Aarav",
  "Abigail",
  "Adrian",
  "Aisha",
  "Alejandro",
  "Amelia",
  "Ananya",
  "Andre",
  "Ari",
  "Ava",
  "Benjamin",
  "Bianca",
  "Caleb",
  "Camila",
  "Chen",
  "Chloe",
  "Daniel",
  "Daria",
  "Diego",
  "Elena",
  "Eli",
  "Emily",
  "Ethan",
  "Fatima",
  "Felix",
  "Gabriel",
  "Grace",
  "Hana",
  "Harper",
  "Ibrahim",
  "Isabella",
  "Ishaan",
  "Jada",
  "James",
  "Jia",
  "Jonah",
  "Julia",
  "Kai",
  "Kavya",
  "Leah",
  "Leo",
  "Liam",
  "Lucia",
  "Maya",
  "Mei",
  "Miguel",
  "Mila",
  "Nadia",
  "Nathan",
  "Nia",
  "Noah",
  "Olivia",
  "Omar",
  "Priya",
  "Rafael",
  "Riya",
  "Rohan",
  "Samir",
  "Sara",
  "Sofia",
  "Tariq",
  "Theo",
  "Uma",
  "Victor",
  "Wei",
  "Yara",
  "Yusuf",
  "Zara",
  "Zoe",
];
const LAST_NAMES = [
  "Abbott",
  "Alvarez",
  "Bajwa",
  "Bennett",
  "Brooks",
  "Castillo",
  "Chang",
  "Chowdhury",
  "Cohen",
  "Delgado",
  "Desai",
  "Dubois",
  "Evans",
  "Fischer",
  "Flores",
  "Gallagher",
  "Garcia",
  "Goldberg",
  "Gupta",
  "Haddad",
  "Hayes",
  "Hoang",
  "Ibrahim",
  "Iyer",
  "Jensen",
  "Kang",
  "Kapoor",
  "Kim",
  "Kowalski",
  "Lee",
  "Lin",
  "Lopez",
  "Mehta",
  "Mensah",
  "Moreau",
  "Nakamura",
  "Nguyen",
  "Novak",
  "Okafor",
  "Olsen",
  "Park",
  "Patel",
  "Petrov",
  "Quinn",
  "Rahman",
  "Reyes",
  "Rossi",
  "Sato",
  "Schmidt",
  "Shah",
  "Silva",
  "Singh",
  "Sullivan",
  "Tanaka",
  "Torres",
  "Tran",
  "Vargas",
  "Walsh",
  "Wang",
  "Weber",
  "Wu",
  "Yamamoto",
  "Yilmaz",
  "Zhang",
];
const COLLEGES = ["Khoury", "COE", "D'Amore-McKim", "COS", "CSSH", "CAMD", "Bouvé"];
const INTERESTS = [
  "agents",
  "rag",
  "evals",
  "coding tools",
  "startups",
  "research",
  "design",
  "safety",
];
const MEET_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Synthetic addresses on a reserved example domain: never a real student's. */
const CONTACT_DOMAINS = ["husky.example.edu", "northeastern.example.edu"];

function maskEmail(email: string): { masked: string; domain: string } {
  const [local, domain] = email.split("@");
  return { masked: `${local[0]}***@${domain}`, domain };
}

export interface SeedCbcDemoOptions {
  organizationId: string;
  members: Record<CbcPersonKey, string>;
  intakeProjectId: string;
  labelIds: { needsPresident: string; design: string };
  now?: Date;
  seed?: number;
}

export interface SeedCbcDemoResult {
  events: number;
  contacts: number;
  attendance: number;
  signups: number;
  ballots: number;
  tasks: number;
}

/**
 * Seed-only CBC data. Runs as the migration owner from prisma/seed.ts, so it
 * may call the rollup and explode functions directly. Refuses production.
 */
export async function seedCbcDemoData(
  db: Db,
  opts: SeedCbcDemoOptions,
): Promise<SeedCbcDemoResult> {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("seedCbcDemoData refuses to run in production (VERCEL_ENV=production).");
  }
  const { organizationId, members } = opts;
  const now = opts.now ?? new Date();
  const rng = createRng(opts.seed ?? 20260922);
  const monday = mondayOf(now);
  const DAY = 24 * 60 * 60 * 1000;

  // ---- Sessions (Events) --------------------------------------------------
  const sessions: { id: string; startsAt: Date; plan: SessionPlan }[] = [];
  for (const plan of CBC_SESSION_PLAN) {
    const startsAt = cbcTime(monday, plan.week, plan.day, plan.hour);
    const hostUserId = plan.host ? members[plan.host] : null;
    const slug = plan.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const event = await db.event.create({
      data: {
        organizationId,
        title: plan.title,
        description: plan.description ?? null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + plan.minutes * 60 * 1000),
        location: plan.location,
        kind: plan.kind,
        visibility: plan.visibility,
        hostUserId,
        hostName: plan.hostName ?? null,
        rsvpUrl:
          plan.visibility === EventVisibility.PUBLIC
            ? `https://example.com/cbc/rsvp/${slug}`
            : null,
        stampSlot: plan.stampSlot ?? null,
        featured: plan.featured ?? false,
        createdById: members.oliver,
      },
      select: { id: true },
    });
    sessions.push({ id: event.id, startsAt, plan });
  }
  const leads = [
    members.jackson,
    members.oliver,
    members.lucas,
    members.anthony,
    members.alex,
    members.smyan,
    members.kristine,
  ];
  for (let week = EXEC_SYNC.fromWeek; week <= EXEC_SYNC.toWeek; week++) {
    const startsAt = cbcTime(monday, week, EXEC_SYNC.day, EXEC_SYNC.hour);
    await db.event.create({
      data: {
        organizationId,
        title: "Weekly exec sync",
        description:
          "30 minutes, blockers only. Agenda: open blockers from Sunday updates, then decisions needed this week.",
        startsAt,
        endsAt: new Date(startsAt.getTime() + EXEC_SYNC.minutes * 60 * 1000),
        location: "Zoom (link in Slack)",
        kind: EventKind.BOARD_MEETING,
        visibility: EventVisibility.INTERNAL,
        hostUserId: members.oliver,
        createdById: members.oliver,
        attendees: {
          create: leads.map((userId) => ({
            userId,
            rsvp: startsAt < now ? "YES" : rng.pick(["YES", "YES", "PENDING", "MAYBE"] as const),
          })),
        },
      },
    });
  }
  const pastSessions = sessions.filter(
    (s) => s.startsAt.getTime() + 90 * 60 * 1000 < now.getTime(),
  );
  // Event.term is filled by the database (app.term_of in the org timezone);
  // check-ins copy it.
  const termByEvent = new Map(
    (await db.event.findMany({ where: { organizationId }, select: { id: true, term: true } })).map(
      (e) => [e.id, e.term],
    ),
  );

  // ---- Contacts ---------------------------------------------------------------
  // Engagement profiles give varied stamp counts and retention: regulars,
  // casual attendees, one-and-done visitors, lapsed early attendees, and
  // people who signed up but never came.
  type Profile = "regular" | "casual" | "once" | "lapsed" | "never";
  const profiles: Profile[] = [];
  const counts: Record<Profile, number> = {
    regular: 18,
    casual: 42,
    once: 34,
    lapsed: 26,
    never: 40,
  };
  for (const [p, n] of Object.entries(counts) as [Profile, number][])
    for (let i = 0; i < n; i++) profiles.push(p);

  interface ContactRow {
    id: string;
    profile: Profile;
    email: string;
    userId: string | null;
    name: string;
  }
  const contacts: ContactRow[] = [];
  const usedEmails = new Set<string>();
  const firstSeenBase = cbcTime(monday, -5, 0, 9);
  for (const profile of profiles) {
    let first = "";
    let last = "";
    let email = "";
    do {
      first = rng.pick(FIRST_NAMES);
      last = rng.pick(LAST_NAMES);
      email = `${first}.${last}`.toLowerCase() + `@${CONTACT_DOMAINS[0]}`;
    } while (usedEmails.has(email));
    usedEmails.add(email);
    const { masked, domain } = maskEmail(email);
    const created = await db.contact.create({
      data: {
        organizationId,
        displayName: `${first} ${last}`,
        emailMasked: masked,
        emailDomain: domain,
        firstSeenAt: new Date(firstSeenBase.getTime() + rng.int(0, 30) * DAY),
        unsubscribedAt: rng.chance(0.05) ? new Date(now.getTime() - rng.int(1, 10) * DAY) : null,
        emails: {
          create: [
            { emailNormalized: email, isPrimary: true },
            ...(rng.chance(0.25)
              ? [
                  {
                    emailNormalized: `${first[0]}${last}`.toLowerCase() + `@${CONTACT_DOMAINS[1]}`,
                    isPrimary: false,
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });
    contacts.push({ id: created.id, profile, email, userId: null, name: `${first} ${last}` });
  }
  // Board members are contacts too (they check in), linked to their users.
  for (const person of CBC_PEOPLE) {
    const email = `${person.key}@board.example.edu`;
    const { masked, domain } = maskEmail(email);
    const created = await db.contact.create({
      data: {
        organizationId,
        displayName: person.name,
        emailMasked: masked,
        emailDomain: domain,
        userId: members[person.key],
        firstSeenAt: cbcTime(monday, -6, 0, 9),
        emails: { create: [{ emailNormalized: email, isPrimary: true }] },
      },
      select: { id: true },
    });
    contacts.push({
      id: created.id,
      profile: person.key === "mehr" ? "casual" : "regular",
      email,
      userId: members[person.key],
      name: person.name,
    });
  }

  // ---- Attendance -------------------------------------------------------------
  const attendanceRows: Prisma.AttendanceCreateManyInput[] = [];
  let externalSeq = 1000;
  for (const contact of contacts) {
    const attended = new Set<number>();
    pastSessions.forEach((s, i) => {
      const p =
        contact.profile === "regular"
          ? 0.9
          : contact.profile === "casual"
            ? 0.45
            : contact.profile === "lapsed"
              ? i < 3
                ? 0.85
                : 0.03
              : 0;
      if (rng.chance(p)) attended.add(i);
    });
    if (contact.profile === "once" && pastSessions.length) {
      attended.add(rng.chance(0.5) ? 0 : rng.int(0, pastSessions.length - 1));
    }
    for (const i of attended) {
      const s = pastSessions[i];
      const method = rng.chance(0.8)
        ? AttendanceMethod.QR
        : rng.chance(0.75)
          ? AttendanceMethod.FORM
          : AttendanceMethod.MANUAL;
      const synced = method !== AttendanceMethod.MANUAL;
      attendanceRows.push({
        organizationId,
        eventId: s.id,
        contactId: contact.id,
        term: termByEvent.get(s.id) ?? "unknown",
        checkedInAt: new Date(s.startsAt.getTime() + rng.int(-5, 25) * 60 * 1000),
        method,
        nameAsEntered: contact.name,
        source: synced ? RecordSource.SUPABASE_SYNC : RecordSource.SUITE,
        externalId: synced ? `ck_${externalSeq++}` : null,
        createdById: synced ? null : members.smyan,
      });
    }
  }
  // Two check-ins the board suppressed (a duplicate scan and a test scan).
  if (attendanceRows.length > 2) {
    attendanceRows[3].suppressedAt = now;
    attendanceRows[7].suppressedAt = now;
  }
  await db.attendance.createMany({ data: attendanceRows });

  // ---- Signups ------------------------------------------------------------------
  const signupRows: Prisma.SignupCreateManyInput[] = [];
  let signupSeq = 500;
  for (const contact of contacts) {
    if (contact.userId) continue;
    if (contact.profile !== "never" && !rng.chance(0.7)) continue;
    const channel = rng.chance(0.7)
      ? SignupSource.WEB
      : rng.pick([SignupSource.TYPEFORM, SignupSource.OFFICER, SignupSource.CSV]);
    const signedUpAt = new Date(
      cbcTime(monday, -4, 0, 12).getTime() + rng.int(0, 30) * DAY + rng.int(0, 600) * 60 * 1000,
    );
    if (signedUpAt > now) continue;
    const synced = channel === SignupSource.WEB || channel === SignupSource.TYPEFORM;
    signupRows.push({
      organizationId,
      contactId: contact.id,
      term: "fall-2026",
      channel,
      classYear: String(rng.pick([2026, 2027, 2028, 2029, 2029, 2030])),
      signedUpAt,
      submissions: rng.chance(0.1) ? 2 : 1,
      addedToListAt: rng.chance(0.6) ? new Date(signedUpAt.getTime() + rng.int(1, 3) * DAY) : null,
      answers: {
        colleges: rng.sample(COLLEGES, rng.int(1, 2)),
        meet_days: rng.sample(MEET_DAYS, rng.int(1, 3)),
        interests: rng.sample(INTERESTS, rng.int(1, 3)),
      },
      externalId: synced ? `sg_${signupSeq++}` : null,
      recordSource: synced
        ? RecordSource.SUPABASE_SYNC
        : channel === SignupSource.CSV
          ? RecordSource.CSV
          : RecordSource.SUITE,
    });
  }
  await db.signup.createMany({ data: signupRows });

  // ---- Ballots -------------------------------------------------------------------
  const infoSession = sessions.find((s) => s.plan.kind === EventKind.INFO_SESSION);
  const hackathon = sessions.find((s) => s.plan.kind === EventKind.HACKATHON);
  const topics = await db.ballotDefinition.create({
    data: {
      organizationId,
      slug: "fall-workshop-topics",
      title: "Which workshop topics do you want most?",
      opensAt: cbcTime(monday, -3, 1, 17),
      closesAt: cbcTime(monday, -1, 6, 23),
      linkedEventId: infoSession?.id ?? null,
      definition: {
        questions: [
          {
            key: "topics",
            label: "Rank the topics you want (top 3)",
            type: "slots",
            options: [
              { key: "agents", label: "Agents" },
              { key: "rag", label: "Retrieval (RAG)" },
              { key: "evals", label: "Evals" },
              { key: "mcp", label: "MCP servers" },
              { key: "claude-code", label: "Claude Code" },
              { key: "vision", label: "Vision and PDFs" },
            ],
          },
          {
            key: "format",
            label: "Preferred format",
            type: "single",
            options: [
              { key: "in-person", label: "In person" },
              { key: "hybrid", label: "Hybrid" },
            ],
          },
          { key: "notes", label: "Anything else?", type: "text" },
        ],
      },
    },
    select: { id: true },
  });
  const themeVote = await db.ballotDefinition.create({
    data: {
      organizationId,
      slug: "hackathon-theme",
      title: "Hackathon theme and tracks",
      opensAt: cbcTime(monday, -1, 0, 9),
      closesAt: cbcTime(monday, 1, 6, 23),
      linkedEventId: hackathon?.id ?? null,
      definition: {
        questions: [
          {
            key: "theme",
            label: "Theme",
            type: "single",
            options: [
              { key: "campus-life", label: "Campus life" },
              { key: "climate", label: "Climate" },
              { key: "education", label: "Education" },
              { key: "open", label: "Open track" },
            ],
          },
          {
            key: "tracks",
            label: "Tracks you would enter",
            type: "multi",
            options: [
              { key: "agents", label: "Agents" },
              { key: "tools", label: "Developer tools" },
              { key: "social-good", label: "Social good" },
            ],
          },
          { key: "first_hackathon", label: "Is this your first hackathon?", type: "yesno" },
        ],
      },
    },
    select: { id: true },
  });
  const testPoll = await db.ballotDefinition.create({
    data: {
      organizationId,
      slug: "test-poll",
      title: "Test poll (check-in QA)",
      isTest: true,
      definition: {
        questions: [
          { key: "q", label: "Test", type: "single", options: [{ key: "a", label: "A" }] },
        ],
      },
    },
    select: { id: true },
  });

  const ballotIds: string[] = [];
  let ballotSeq = 1;
  const topicWeights = [
    "agents",
    "agents",
    "agents",
    "rag",
    "rag",
    "claude-code",
    "claude-code",
    "mcp",
    "evals",
    "vision",
  ];
  for (let i = 0; i < 58; i++) {
    const ranked: string[] = [];
    while (ranked.length < 3) {
      const t = rng.pick(topicWeights);
      if (!ranked.includes(t)) ranked.push(t);
    }
    const b = await db.ballot.create({
      data: {
        organizationId,
        ballotDefinitionId: topics.id,
        pollSlug: "fall-workshop-topics",
        answers: {
          topics: ranked,
          format: rng.chance(0.78) ? "in-person" : "hybrid",
          ...(rng.chance(0.2)
            ? {
                notes: rng.pick([
                  "More starter code please",
                  "Pizza helps",
                  "Record the sessions?",
                  "More advanced topics",
                ]),
              }
            : {}),
        },
        castAt: new Date(
          cbcTime(monday, -3, 1, 19).getTime() + rng.int(0, 13 * 24 * 60) * 60 * 1000,
        ),
        source: RecordSource.SUPABASE_SYNC,
        externalId: `b_${ballotSeq++}`,
      },
      select: { id: true },
    });
    ballotIds.push(b.id);
  }
  for (let i = 0; i < 41; i++) {
    const b = await db.ballot.create({
      data: {
        organizationId,
        ballotDefinitionId: themeVote.id,
        pollSlug: "hackathon-theme",
        answers: {
          theme: rng.pick([
            "campus-life",
            "climate",
            "education",
            "education",
            "open",
            "open",
            "open",
          ]),
          tracks: rng.sample(["agents", "tools", "social-good"], rng.int(1, 2)),
          first_hackathon: rng.chance(0.55),
        },
        castAt: new Date(
          Math.min(
            now.getTime() - 60 * 60 * 1000,
            cbcTime(monday, -1, 0, 10).getTime() + rng.int(0, 7 * 24 * 60) * 60 * 1000,
          ),
        ),
        source: RecordSource.SUPABASE_SYNC,
        externalId: `b_${ballotSeq++}`,
      },
      select: { id: true },
    });
    ballotIds.push(b.id);
  }
  for (let i = 0; i < 2; i++) {
    const b = await db.ballot.create({
      data: {
        organizationId,
        ballotDefinitionId: testPoll.id,
        pollSlug: "test-poll",
        answers: { q: "a" },
        castAt: cbcTime(monday, -3, 0, 12),
        source: RecordSource.SUPABASE_SYNC,
        externalId: `b_${ballotSeq++}`,
        excludedReason: "test ballot",
      },
      select: { id: true },
    });
    ballotIds.push(b.id);
  }
  for (const id of ballotIds) {
    await db.$queryRaw`SELECT app.explode_ballot(${organizationId}, ${id}) AS n`;
  }

  // Rollups: terms from the events, stamps, first visits, per-term stats,
  // contact totals, signup conversion, attendance counts, then lapsed.
  await db.$queryRaw`SELECT app.refresh_contact_rollups(${organizationId}, NULL)::text AS ok`;
  await db.$queryRaw`SELECT app.refresh_lapsed(${organizationId}) AS n`;

  // ---- Tasks ----------------------------------------------------------------------
  const taskCount = await seedCbcTasks(db, {
    organizationId,
    members,
    now,
    monday,
    rng,
    intakeProjectId: opts.intakeProjectId,
    labelIds: opts.labelIds,
  });

  // ---- Sunday updates for last week ------------------------------------------------
  const lastWeek = new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7),
  );
  const updates: [CbcPersonKey, string[], string[], string[]][] = [
    [
      "oliver",
      ["Ran exec sync; closed 4 blockers", "Locked the October workshop calendar"],
      ["Hackathon logistics plan", "Collect Sunday updates"],
      [],
    ],
    [
      "lucas",
      ["Tabling at Club Fair follow-ups sent", "Instagram reach up 30% week over week"],
      ["Board application round plan", "Designer job post"],
      ["Designer hire: waiting on job post approval"],
    ],
    [
      "anthony",
      ["September budget report sent to Jackson", "Processed 6 reimbursements"],
      ["SAO funding application draft"],
      [],
    ],
    [
      "alex",
      ["Workshops 4 and 5 delivered", "Feedback form results summarized"],
      ["Workshop 6 starter repo", "Book October rooms"],
      ["Room booking office closed until Wednesday"],
    ],
    [
      "smyan",
      ["Check-in page handles duplicate scans", "Stamp-card counts back-filled"],
      ["Rewards page", "Starter code QA for Workshop 6"],
      [],
    ],
    [
      "kristine",
      ["Welcome emails and Slack invites for 42 new members", "Newsletter #3 sent"],
      ["Promo posts for Workshops 6-8"],
      ["Waiting on flyer for Workshop 7 (Design Requests)"],
    ],
  ];
  for (const [person, done, next, blocked] of updates) {
    await db.weeklyUpdate.create({
      data: {
        organizationId,
        userId: members[person],
        weekStart: lastWeek,
        done,
        next,
        blocked,
        postedAt: cbcTime(monday, -1, 6, 21),
      },
    });
  }

  // ---- Notes ---------------------------------------------------------------------------
  const agenda =
    "Blockers only. 1) Open blockers from Sunday updates. 2) Decisions needed this week. " +
    "3) Anything that needs the President (brand use, spend over the limit, partnerships, board changes).";
  await db.note.create({
    data: {
      organizationId,
      title: "Exec sync agenda template",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: agenda }] }],
      },
      contentText: agenda,
      visibility: "ORGANIZATION",
      authorId: members.oliver,
      updatedById: members.oliver,
    },
  });

  // ---- Budget ------------------------------------------------------------------------
  await seedCbcBudget(db, { organizationId, members, monday, rng });

  const attendanceCount = attendanceRows.length;
  return {
    events: sessions.length + (EXEC_SYNC.toWeek - EXEC_SYNC.fromWeek + 1),
    contacts: contacts.length,
    attendance: attendanceCount,
    signups: signupRows.length,
    ballots: ballotIds.length,
    tasks: taskCount,
  };
}

interface TaskSeedContext {
  organizationId: string;
  members: Record<CbcPersonKey, string>;
  now: Date;
  monday: TZDate;
  rng: Rng;
  intakeProjectId: string;
  labelIds: { needsPresident: string; design: string };
}

interface TaskPlan {
  ref: string;
  title: string;
  description?: string;
  owner: CbcPersonKey;
  createdBy: CbcPersonKey;
  /** Due: weeks from this week's Monday, plus a day of the week. */
  due: [number, number];
  status: TaskStatus;
  priority: TaskPriority;
  labels?: ("needsPresident" | "design")[];
  intake?: boolean;
  parent?: string;
  relation?: AssignmentRelation;
  blockedReason?: string;
  collaborators?: CbcPersonKey[];
  /** C4: PRIVATE narrows the task to its own people plus OWNER/ADMIN. */
  visibility?: TaskVisibility;
}

const CBC_TASKS: readonly TaskPlan[] = [
  {
    ref: "speaker",
    title: "Confirm Anthropic guest speaker for Workshop 9",
    description:
      "Speaker bio, headshot and talk abstract for the promo posts. Brand use needs sign-off.",
    owner: "jackson",
    createdBy: "jackson",
    due: [1, 4],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    labels: ["needsPresident"],
  },
  {
    ref: "khoury",
    title: "Khoury faculty advisor check-in",
    owner: "jackson",
    createdBy: "oliver",
    due: [0, 3],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
    labels: ["needsPresident"],
    relation: "ABOVE",
  },
  {
    ref: "sao",
    title: "Submit SAO funding application",
    description: "Hackathon prizes and food. Draft by Friday, Jackson reviews before submitting.",
    owner: "anthony",
    createdBy: "jackson",
    due: [2, 0],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    labels: ["needsPresident"],
    relation: "DOWN_LINE",
    collaborators: ["jackson"],
  },
  {
    ref: "sao-receipts",
    title: "Collect September receipts for the SAO application",
    owner: "anthony",
    createdBy: "anthony",
    due: [1, 2],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
    parent: "sao",
  },
  {
    ref: "budget-report",
    title: "Monthly budget report to Jackson",
    owner: "anthony",
    createdBy: "anthony",
    due: [1, 0],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
  },
  {
    ref: "rooms",
    title: "Book rooms for October workshops",
    description: "Richards 300 or West Village H 110, Tuesdays and Thursdays 6-7:30pm.",
    owner: "alex",
    createdBy: "oliver",
    due: [0, 4],
    status: TaskStatus.BLOCKED,
    priority: TaskPriority.HIGH,
    relation: "DOWN_LINE",
    blockedReason:
      "The Curry Student Center reservation office is closed until Wednesday; requests are queued.",
  },
  {
    ref: "hackathon",
    title: "Plan hackathon tracks, judging and logistics",
    owner: "oliver",
    createdBy: "oliver",
    due: [3, 4],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    collaborators: ["alex", "smyan"],
  },
  {
    ref: "hackathon-tracks",
    title: "Draft hackathon track descriptions",
    owner: "alex",
    createdBy: "oliver",
    due: [1, 3],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.MEDIUM,
    parent: "hackathon",
    relation: "DOWN_LINE",
  },
  {
    ref: "hackathon-judging",
    title: "Build the hackathon judging form",
    owner: "smyan",
    createdBy: "oliver",
    due: [2, 3],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
    parent: "hackathon",
    relation: "DOWN_LINE",
  },
  {
    ref: "workshop6-repo",
    title: "Workshop 6 starter repo and slides",
    owner: "alex",
    createdBy: "alex",
    due: [0, 0],
    status: TaskStatus.COMPLETED,
    priority: TaskPriority.HIGH,
  },
  {
    ref: "rewards",
    title: "Ship the stamp-card rewards page",
    owner: "smyan",
    createdBy: "smyan",
    due: [1, 2],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.MEDIUM,
  },
  {
    ref: "member-data",
    title: "Export inactive-member list for re-engagement",
    owner: "smyan",
    createdBy: "kristine",
    due: [0, 2],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.LOW,
    relation: "PEER",
  },
  {
    ref: "welcome",
    title: "Send new-member welcome and Slack invites",
    owner: "kristine",
    createdBy: "kristine",
    due: [-1, 2],
    status: TaskStatus.COMPLETED,
    priority: TaskPriority.MEDIUM,
  },
  {
    ref: "promo",
    title: "Instagram and TikTok posts for Workshops 6-8",
    owner: "kristine",
    createdBy: "lucas",
    due: [0, 1],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.MEDIUM,
    relation: "DOWN_LINE",
  },
  {
    ref: "newsletter",
    title: "Newsletter #4",
    owner: "kristine",
    createdBy: "kristine",
    due: [-1, 4],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.LOW,
  },
  {
    ref: "recruitment",
    title: "Spring board application round plan",
    owner: "lucas",
    createdBy: "lucas",
    due: [3, 0],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
  },
  {
    ref: "designer-post",
    title: "Post the Graphic Designer role",
    owner: "lucas",
    createdBy: "jackson",
    due: [0, 4],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    labels: ["needsPresident"],
    relation: "DOWN_LINE",
  },
  {
    ref: "flyer-w7",
    title: "Flyer: Workshop 7 (Claude Code for Your Projects)",
    description: "Instagram square plus a printable 11x17. Needs the room number.",
    owner: "lucas",
    createdBy: "kristine",
    due: [0, 2],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.HIGH,
    labels: ["design"],
    intake: true,
  },
  {
    ref: "hackathon-brand",
    title: "Hackathon logo, banner and slide template",
    owner: "lucas",
    createdBy: "oliver",
    due: [2, 2],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
    labels: ["design"],
    intake: true,
  },
  {
    ref: "brand-kit",
    title: "Brand kit: colors, fonts and templates",
    owner: "lucas",
    createdBy: "lucas",
    due: [4, 0],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.LOW,
    labels: ["design"],
    intake: true,
  },
  {
    ref: "sunday",
    title: "Collect Sunday updates and flag blockers",
    owner: "oliver",
    createdBy: "oliver",
    due: [0, 6],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
  },
  {
    ref: "feedback",
    title: "Summarize Workshop 5 feedback",
    owner: "alex",
    createdBy: "alex",
    due: [-1, 5],
    status: TaskStatus.COMPLETED,
    priority: TaskPriority.LOW,
  },
  // C4: the board is open by default, and these three are the exception. A
  // club board has a handful of things that are not everybody's business
  // yet: succession, a pay-style conversation, an unannounced partnership.
  {
    ref: "transition",
    title: "Spring exec transition plan",
    description:
      "Who takes President, VP Ops and Treasurer in the spring, and what each handover needs. Share once the slate is settled.",
    owner: "jackson",
    createdBy: "jackson",
    due: [2, 4],
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    visibility: TaskVisibility.PRIVATE,
    collaborators: ["oliver"],
  },
  {
    // Inherits PRIVATE from its parent (the database trigger enforces it).
    ref: "transition-slate",
    title: "Draft the slate and check who is returning",
    owner: "oliver",
    createdBy: "jackson",
    due: [1, 4],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
    parent: "transition",
    relation: "DOWN_LINE",
  },
  {
    ref: "alex-growth",
    title: "1:1 notes and growth plan for Alex",
    description: "Prep for the mid-semester check-in. Not for the board channel.",
    owner: "oliver",
    createdBy: "oliver",
    due: [1, 2],
    status: TaskStatus.NOT_STARTED,
    priority: TaskPriority.MEDIUM,
    visibility: TaskVisibility.PRIVATE,
  },
];

async function seedCbcTasks(db: Db, ctx: TaskSeedContext): Promise<number> {
  const { organizationId, members, monday, now } = ctx;
  const byStatus = new Map<TaskStatus, number>();
  const topLevel = CBC_TASKS.filter((t) => !t.parent);
  for (const t of topLevel) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  const ranks = new Map<TaskStatus, string[]>();
  for (const [status, n] of byStatus) ranks.set(status, generateNKeysBetween(null, null, n));
  const cursor = new Map<TaskStatus, number>();

  const ids = new Map<string, string>();
  for (const t of CBC_TASKS) {
    let rank: string;
    if (t.parent) {
      rank = generateNKeysBetween(null, null, 1)[0];
    } else {
      const i = cursor.get(t.status) ?? 0;
      cursor.set(t.status, i + 1);
      rank = ranks.get(t.status)![i];
    }
    // Due dates are floating calendar dates (UTC midnight of the local day; see
    // src/lib/tasks/dates.ts), never an instant.
    const dueDate = fromDateKey(
      localDateKey(cbcTime(monday, t.due[0], t.due[1], 12), CBC_TIMEZONE),
    );
    const completed = t.status === TaskStatus.COMPLETED;
    const created = await db.task.create({
      data: {
        organizationId,
        projectId: t.intake ? ctx.intakeProjectId : null,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        // A subtask's flag is forced to its parent's by the
        // task_visibility_inherit trigger, whatever is passed here.
        visibility: t.visibility ?? TaskVisibility.ORG,
        priority: t.priority,
        dueDate,
        rank,
        parentTaskId: t.parent ? ids.get(t.parent)! : null,
        createdById: members[t.createdBy],
        ownerId: members[t.owner],
        ownerRelation: t.relation ?? (t.owner === t.createdBy ? "SELF" : "OUTSIDE_CHART"),
        ownerFlagged: t.relation === "ABOVE",
        ownerAssignedById: members[t.createdBy],
        blockedReason: t.blockedReason ?? null,
        blockedAt:
          t.status === TaskStatus.BLOCKED ? new Date(now.getTime() - 26 * 60 * 60 * 1000) : null,
        completedAt: completed
          ? new Date(Math.min(now.getTime(), dueDate.getTime()) - 60 * 60 * 1000)
          : null,
        assignees: t.collaborators?.length
          ? {
              create: t.collaborators.map((c) => ({
                userId: members[c],
                assignedById: members[t.createdBy],
                relation: c === t.createdBy ? ("SELF" as const) : ("OUTSIDE_CHART" as const),
              })),
            }
          : undefined,
        labels: t.labels?.length
          ? { create: t.labels.map((l) => ({ labelId: ctx.labelIds[l] })) }
          : undefined,
        activity: {
          create: [
            { actorId: members[t.createdBy], type: "CREATED", diffJson: { title: t.title } },
            ...(t.status === TaskStatus.BLOCKED
              ? [
                  {
                    actorId: members[t.owner],
                    type: "BLOCKED",
                    diffJson: { reason: t.blockedReason ?? "" },
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });
    ids.set(t.ref, created.id);
  }

  // A comment thread with a mention, and the matching notification.
  const roomsId = ids.get("rooms")!;
  const comment = await db.taskComment.create({
    data: {
      organizationId,
      taskId: roomsId,
      authorId: members.oliver,
      body: `@[Alex Green](user:${members.alex}) if the office is still closed Wednesday, book Richards 300 as the fallback.`,
    },
    select: { id: true },
  });
  await db.taskComment.create({
    data: {
      organizationId,
      taskId: roomsId,
      authorId: members.alex,
      body: "Will do. Request is in the queue for Tue/Thu 6pm.",
    },
  });
  await db.taskMention.create({
    data: {
      organizationId,
      taskId: roomsId,
      sourceKey: comment.id,
      mentionedUserId: members.alex,
      mentionedById: members.oliver,
    },
  });
  await db.notification.create({
    data: {
      organizationId,
      userId: members.alex,
      type: "TASK_MENTIONED",
      title: 'Oliver Ward mentioned you on "Book rooms for October workshops"',
      linkUrl: `/app/${CBC_ORG.slug}/tasks`,
      taskId: roomsId,
      actorId: members.oliver,
      dedupeKey: `mention:${roomsId}:${comment.id}`,
    },
  });
  await db.notification.create({
    data: {
      organizationId,
      userId: members.lucas,
      type: "TASK_ASSIGNED",
      title: "Kristine Min filed a design request: Flyer: Workshop 7",
      linkUrl: `/app/${CBC_ORG.slug}/tasks`,
      taskId: ids.get("flyer-w7")!,
      actorId: members.kristine,
    },
  });
  return CBC_TASKS.length;
}

async function seedCbcBudget(
  db: Db,
  ctx: { organizationId: string; members: Record<CbcPersonKey, string>; monday: TZDate; rng: Rng },
): Promise<void> {
  const { organizationId, members, monday, rng } = ctx;
  const year = monday.getMonth() >= 6 ? monday.getFullYear() : monday.getFullYear() - 1;
  const period = await db.budgetPeriod.create({
    data: {
      organizationId,
      label: `Fall ${year}`,
      startsOn: new Date(Date.UTC(year, 7, 15)),
      endsOn: new Date(Date.UTC(year, 11, 20)),
      isActive: true,
    },
    select: { id: true },
  });
  const categories = [
    { name: "Workshop food", allocatedCents: 180_000 },
    { name: "Hackathon", allocatedCents: 350_000 },
    { name: "Marketing and print", allocatedCents: 40_000 },
    { name: "Socials", allocatedCents: 60_000 },
  ];
  const categoryIds: string[] = [];
  for (const [i, c] of categories.entries()) {
    const created = await db.budgetCategory.create({
      data: { organizationId, budgetPeriodId: period.id, sortOrder: i, ...c },
      select: { id: true },
    });
    categoryIds.push(created.id);
  }
  await db.transaction.create({
    data: {
      organizationId,
      budgetPeriodId: period.id,
      direction: "IN",
      kind: "ALLOCATION",
      amountCents: 450_000,
      description: "SAO fall allocation",
      occurredAt: cbcTime(monday, -4, 1, 12),
      status: "NOT_APPLICABLE",
      submittedById: members.anthony,
    },
  });
  const expenses: [
    CbcPersonKey,
    number,
    string,
    number,
    "APPROVED" | "REIMBURSED" | "SUBMITTED",
  ][] = [
    ["alex", 0, "Pizza for Workshop 1", 18_450, "REIMBURSED"],
    ["kristine", 3, "Boba for the Welcome Social", 21_600, "REIMBURSED"],
    ["alex", 0, "Pizza for Workshop 2", 16_900, "APPROVED"],
    ["kristine", 2, "Club fair flyers (print)", 4_800, "APPROVED"],
    ["alex", 0, "Pizza for Workshop 4", 17_350, "SUBMITTED"],
    ["smyan", 0, "Snacks for Workshop 5", 6_200, "SUBMITTED"],
  ];
  for (const [who, cat, description, amountCents, status] of expenses) {
    const occurredAt = cbcTime(monday, rng.int(-3, -1), rng.int(0, 4), 18);
    await db.transaction.create({
      data: {
        organizationId,
        budgetPeriodId: period.id,
        categoryId: categoryIds[cat],
        direction: "OUT",
        kind: "EXPENSE",
        amountCents,
        description,
        counterparty: description.startsWith("Pizza")
          ? "Regina Pizzeria"
          : description.includes("Boba")
            ? "Kung Fu Tea"
            : "Campus Print Shop",
        occurredAt,
        paymentMethod: "Personal card, reimbursed",
        status,
        submittedById: members[who],
        approvedById: status === "SUBMITTED" ? null : members.anthony,
        approvedAt:
          status === "SUBMITTED" ? null : new Date(occurredAt.getTime() + 2 * 24 * 60 * 60 * 1000),
        reimbursedAt:
          status === "REIMBURSED" ? new Date(occurredAt.getTime() + 5 * 24 * 60 * 60 * 1000) : null,
        reimbursementMethod: status === "REIMBURSED" ? "SAO reimbursement form" : null,
      },
    });
  }
}
