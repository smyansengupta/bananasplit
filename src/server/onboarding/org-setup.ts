import { EventKind, EventVisibility, MemberVisibility, Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { FINANCE_CARD_IDS } from "@/lib/finance/dashboard-cards";
import {
  DATA_TAGS,
  MEETING_WEEKS_AHEAD,
  defaultTagForKind,
  describeMeeting,
  financeInputSchema,
  fiscalYearFor,
  isDataTag,
  labelsInputSchema,
  meetingOccurrences,
  teamsInputSchema,
  type DataTag,
} from "@/lib/onboarding/org";
import { localDateKey } from "@/lib/tasks/dates";
import { writeOrgAuditLog } from "@/server/audit";
import { invalidate } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import type { OrgContext } from "@/server/db/context";
import { createEvent } from "@/server/events/service";
import { publishDraft, saveDraft, startDraft } from "@/server/org-chart/service";
import { DEFAULT_CATEGORY_NAMES } from "@/lib/finance/default-categories";

/**
 * Org setup (onboarding Flow B, steps B3-B5), on the member path for an
 * OWNER/ADMIN of the new org (withOrgAction / withOrgTx: RLS applies). Each
 * step writes to the features that already exist, so what the admin sets
 * here is exactly what the app shows afterwards:
 *
 *   B3 labels   DatabaseDefinition.name / .tag / .memberVisibility
 *   B4 finance  OrgSettings.financeDashboardCards and the first BudgetPeriod
 *   B5 teams    a published org chart, the team meetings on the calendar and
 *               OrgSettings.showMemberAvailability
 */

export type StepResult = { ok: true } | { ok: false; error: string };

/**
 * A refusal after something was already written: thrown so the whole step's
 * transaction rolls back; the action turns it into { ok: false, error }.
 */
export class StepFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepFailure";
  }
}

// ---------------------------------------------------------------- B3

export interface DataSourceRow {
  id: string;
  key: string;
  name: string;
  kind: string;
  tag: DataTag;
  memberVisibility: MemberVisibility;
}

export async function loadDataSources(
  ctx: Pick<OrgContext, "db" | "organizationId">,
): Promise<DataSourceRow[]> {
  const rows = await ctx.db.databaseDefinition.findMany({
    where: { organizationId: ctx.organizationId, archivedAt: null },
    select: { id: true, key: true, name: true, kind: true, tag: true, memberVisibility: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => ({ ...r, tag: isDataTag(r.tag) ? r.tag : defaultTagForKind(r.kind) }));
}

export async function saveDataLabels(ctx: OrgContext, raw: unknown): Promise<StepResult> {
  requirePermission(ctx, "databases.write");
  requirePermission(ctx, "privacy.write");
  const parsed = labelsInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the labels." };
  const { sources, visibility } = parsed.data;

  const known = await ctx.db.databaseDefinition.findMany({
    where: {
      organizationId: ctx.organizationId,
      archivedAt: null,
      id: { in: sources.map((s) => s.id) },
    },
    select: { id: true },
  });
  const knownIds = new Set(known.map((k) => k.id));
  for (const source of sources) {
    if (!knownIds.has(source.id)) continue;
    const tag = source.tag;
    const vis = tag ? visibility[tag] : undefined;
    await ctx.db.databaseDefinition.update({
      where: { id: source.id },
      data: {
        name: source.name,
        tag,
        ...(vis ? { memberVisibility: vis as MemberVisibility } : {}),
      },
      select: { id: true },
    });
  }
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "databases.labelled",
    targetType: "DatabaseDefinition",
    diff: {
      sources: sources.length,
      visibility: Object.fromEntries(
        DATA_TAGS.filter((t) => visibility[t]).map((t) => [t, visibility[t]]),
      ),
    },
  });
  invalidate([tags.databases(ctx.organizationId), tags.reports(ctx.organizationId)]);
  return { ok: true };
}

// ---------------------------------------------------------------- B4

export interface FinanceSetupState {
  cards: string[];
  activePeriod: { label: string; startsOn: string; endsOn: string } | null;
  canManageFinance: boolean;
}

export async function loadFinanceSetup(
  ctx: Pick<OrgContext, "db" | "organizationId" | "role">,
): Promise<FinanceSetupState> {
  const settings = await ctx.db.orgSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { financeDashboardCards: true },
  });
  const period = await ctx.db.budgetPeriod.findFirst({
    where: { organizationId: ctx.organizationId, isActive: true },
    select: { label: true, startsOn: true, endsOn: true },
  });
  const stored = settings?.financeDashboardCards ?? [];
  return {
    cards: stored.length > 0 ? stored : [...FINANCE_CARD_IDS],
    activePeriod: period
      ? {
          label: period.label,
          startsOn: period.startsOn.toISOString().slice(0, 10),
          endsOn: period.endsOn.toISOString().slice(0, 10),
        }
      : null,
    canManageFinance: ctx.role === "OWNER" || ctx.role === "TREASURER",
  };
}

export async function saveFinanceSetup(
  ctx: OrgContext,
  raw: unknown,
  orgTimezone: string,
): Promise<StepResult> {
  requirePermission(ctx, "settings.general.write");
  const parsed = financeInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the finance settings." };
  const { cards, fiscalYearStartMonth, createPeriod } = parsed.data;
  // The budget itself is the treasurer's: OWNER or TREASURER (RLS agrees).
  // Checked before any write, so a refusal leaves nothing half-saved.
  if (createPeriod) requirePermission(ctx, "finance.manage");

  await ctx.db.orgSettings.update({
    where: { organizationId: ctx.organizationId },
    // All of them = the default, stored as empty so new reports show up too.
    data: {
      financeDashboardCards: cards.length === FINANCE_CARD_IDS.length ? [] : cards,
      updatedById: ctx.userId,
    },
    select: { organizationId: true },
  });

  let createdPeriod: string | null = null;
  if (createPeriod) {
    const active = await ctx.db.budgetPeriod.findFirst({
      where: { organizationId: ctx.organizationId, isActive: true },
      select: { id: true },
    });
    if (!active) {
      const fy = fiscalYearFor(localDateKey(new Date(), orgTimezone), fiscalYearStartMonth);
      await ctx.db.budgetPeriod.create({
        data: {
          organizationId: ctx.organizationId,
          label: fy.label,
          startsOn: new Date(`${fy.startsOn}T00:00:00Z`),
          endsOn: new Date(`${fy.endsOn}T00:00:00Z`),
          isActive: true,
          categories: {
            create: DEFAULT_CATEGORY_NAMES.map((name, sortOrder) => ({
              organizationId: ctx.organizationId,
              name,
              allocatedCents: 0,
              sortOrder,
            })),
          },
        },
        select: { id: true },
      });
      createdPeriod = fy.label;
    }
  }
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "finance.setup",
    targetType: "OrgSettings",
    targetId: ctx.organizationId,
    diff: { cards, fiscalYearStartMonth, createdPeriod },
  });
  return { ok: true };
}

// ---------------------------------------------------------------- B5

export interface TeamsSetupState {
  members: { userId: string; name: string }[];
  showMemberAvailability: boolean;
  googleConnected: boolean;
  hasPublishedChart: boolean;
}

export async function loadTeamsSetup(
  ctx: Pick<OrgContext, "db" | "organizationId">,
): Promise<TeamsSetupState> {
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const settings = await ctx.db.orgSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { showMemberAvailability: true },
  });
  const google = await ctx.db.orgIntegration.findFirst({
    where: { organizationId: ctx.organizationId, provider: "GOOGLE_CALENDAR", status: "CONNECTED" },
    select: { id: true },
  });
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { activeOrgChartVersionId: true },
  });
  return {
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name ?? m.user.email.split("@")[0],
    })),
    showMemberAvailability: settings?.showMemberAvailability ?? true,
    googleConnected: Boolean(google),
    hasPublishedChart: Boolean(org?.activeOrgChartVersionId),
  };
}

export async function saveTeamsSetup(
  ctx: OrgContext,
  raw: unknown,
  orgTimezone: string,
): Promise<StepResult & { published?: number; meetings?: number }> {
  requirePermission(ctx, "orgchart.write");
  requirePermission(ctx, "settings.general.write");
  const parsed = teamsInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the teams." };
  const { teams, addMeetingsToCalendar, showMemberAvailability } = parsed.data;
  if (addMeetingsToCalendar) requirePermission(ctx, "events.write");

  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name ?? m.user.email.split("@")[0]]));

  // The org chart: the first team is the top, the rest report to it.
  const versionId = await startDraft(ctx, "blank");
  const positions = teams.map((team, i) => {
    const lead = team.leadUserId && nameOf.has(team.leadUserId) ? team.leadUserId : null;
    return {
      id: `team-${i}`,
      title: team.name,
      personName: lead ? (nameOf.get(lead) ?? null) : null,
      userId: lead,
      matchState: lead ? ("CONFIRMED" as const) : ("UNMATCHED" as const),
      matchScore: lead ? 1 : null,
      suggestedUserIds: [],
      reportsTo: i === 0 ? null : "team-0",
      isOpen: !lead,
      isAdvisor: false,
      responsibilities: team.meeting ? [`Meets ${describeMeeting(team.meeting)}`] : [],
      decidesAlone: [],
      rank: "",
    };
  });
  const saved = await saveDraft(ctx, { versionId, editVersion: 1, positions, openItems: [] });
  if (!saved.ok) throw new StepFailure(saved.error);
  const published = await publishDraft(ctx, versionId, { expectedEditVersion: saved.editVersion });
  if (!published.ok) throw new StepFailure(published.issues?.[0]?.message ?? published.error);

  // Team meetings: about a semester of them, skipping any already there.
  let meetings = 0;
  if (addMeetingsToCalendar) {
    const now = new Date();
    for (const [i, team] of teams.entries()) {
      if (!team.meeting) continue;
      const title = `${team.name} meeting`;
      const existing = await ctx.db.event.count({
        where: {
          organizationId: ctx.organizationId,
          title,
          deletedAt: null,
          startsAt: { gt: now },
        },
      });
      if (existing > 0) continue;
      const lead = team.leadUserId && nameOf.has(team.leadUserId) ? team.leadUserId : null;
      for (const startsAt of meetingOccurrences(
        team.meeting,
        orgTimezone,
        now,
        MEETING_WEEKS_AHEAD,
      )) {
        await createEvent(
          {
            db: ctx.db,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
            kind: ctx.kind,
          },
          {
            title,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
            kind: i === 0 ? EventKind.BOARD_MEETING : EventKind.OTHER,
            visibility: EventVisibility.INTERNAL,
            hostUserId: lead,
          },
        );
        meetings++;
      }
    }
  }

  await ctx.db.orgSettings.update({
    where: { organizationId: ctx.organizationId },
    data: { showMemberAvailability, updatedById: ctx.userId },
    select: { organizationId: true },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "teams.setup",
    targetType: "OrgChartVersion",
    targetId: versionId,
    diff: { teams: teams.length, meetings, showMemberAvailability } as Prisma.InputJsonObject,
  });
  invalidate([tags.orgChart(ctx.organizationId), tags.members(ctx.organizationId)]);
  return { ok: true, published: published.number, meetings };
}
