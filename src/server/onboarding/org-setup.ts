import { z } from "zod";

import { EventKind, EventVisibility, Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import {
  MEETING_WEEKS_AHEAD,
  describeMeeting,
  meetingOccurrences,
  taskLabelsInputSchema,
  teamsInputSchema,
} from "@/lib/onboarding/org";
import type { MeetingType } from "@/lib/meetings/meeting-types";
import { writeOrgAuditLog } from "@/server/audit";
import { invalidate } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import type { OrgContext } from "@/server/db/context";
import { createEvent } from "@/server/events/service";
import { publishDraft, saveDraft, startDraft } from "@/server/org-chart/service";

/**
 * Org setup (onboarding Flow B, steps B3-B5), on the member path for an
 * OWNER/ADMIN of the new org (withOrgAction / withOrgTx: RLS applies). Each
 * step writes to the features that already exist, so what the admin sets
 * here is exactly what the app shows afterwards:
 *
 *   B3 labels   the org's task labels (Label), as in Settings > Labels
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

export interface TaskLabelRow {
  id: string;
  name: string;
  color: string;
  /** Tasks carrying the label that the admin can see. */
  taskCount: number;
}

export interface TaskLabelsSetup {
  labels: TaskLabelRow[];
  /** The newest few tasks, for the step's preview. */
  tasks: { id: string; title: string; labelIds: string[] }[];
}

export async function loadTaskLabels(
  ctx: Pick<OrgContext, "db" | "organizationId">,
): Promise<TaskLabelsSetup> {
  const labels = await ctx.db.label.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, _count: { select: { tasks: true } } },
  });
  const tasks = await ctx.db.task.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { id: true, title: true, labels: { select: { labelId: true } } },
  });
  return {
    labels: labels.map(({ _count, ...l }) => ({ ...l, taskCount: _count.tasks })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      labelIds: t.labels.map((l) => l.labelId),
    })),
  };
}

/**
 * The org's task labels as the admin left them: rows with an id are renamed
 * or recoloured, rows without one are created, and labels missing from the
 * list are deleted (their tasks simply lose that label).
 */
export async function saveTaskLabels(ctx: OrgContext, raw: unknown): Promise<StepResult> {
  requirePermission(ctx, "labels.write");
  const parsed = taskLabelsInputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the labels." };
  const { labels } = parsed.data;

  const existing = await ctx.db.label.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((l) => l.id));
  const kept = new Set(labels.flatMap((l) => (l.id && existingIds.has(l.id) ? [l.id] : [])));
  const removed = existing.filter((l) => !kept.has(l.id)).map((l) => l.id);

  if (removed.length > 0) {
    await ctx.db.label.deleteMany({
      where: { organizationId: ctx.organizationId, id: { in: removed } },
    });
  }
  let created = 0;
  for (const label of labels) {
    if (label.id && kept.has(label.id)) {
      await ctx.db.label.updateMany({
        where: { id: label.id, organizationId: ctx.organizationId },
        data: { name: label.name, color: label.color },
      });
    } else {
      await ctx.db.label.create({
        data: { organizationId: ctx.organizationId, name: label.name, color: label.color },
        select: { id: true },
      });
      created++;
    }
  }
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "labels.set_up",
    targetType: "Label",
    diff: { created, kept: kept.size, removed: removed.length },
  });
  return { ok: true };
}

// ---------------------------------------------------------------- Event types

/** A meeting type (src/lib/meetings/meeting-types.ts), as the meetings step edits them. */
export type EventType = MeetingType;

export interface EventTypesSetup {
  /** The organization's event types (none for a new one). */
  types: EventType[];
}

const eventTypesInputSchema = z
  .object({
    types: z
      .array(
        z
          .object({
            name: z.string().trim().min(1, "Name every meeting type.").max(40),
            color: z.string().regex(/^#[0-9a-f]{6}$/i),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export async function loadEventTypes(
  ctx: Pick<OrgContext, "db" | "organizationId">,
): Promise<EventTypesSetup> {
  const settings = await ctx.db.orgSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { eventTypes: true },
  });
  const parsed = eventTypesInputSchema.shape.types.safeParse(settings?.eventTypes);
  return { types: parsed.success ? parsed.data : [] };
}

/** Saves the organization's event types (OWNER/ADMIN), each name once. */
export async function saveEventTypes(ctx: OrgContext, raw: unknown): Promise<StepResult> {
  requirePermission(ctx, "settings.general.write");
  const parsed = eventTypesInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the meeting types." };
  }
  const seen = new Set<string>();
  const types = parsed.data.types.filter((t) => {
    const key = t.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await ctx.db.orgSettings.update({
    where: { organizationId: ctx.organizationId },
    data: { eventTypes: types, updatedById: ctx.userId },
    select: { organizationId: true },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "settings.event_types",
    targetType: "OrgSettings",
    diff: { types: types.map((t) => t.name) },
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
