import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import {
  addDaysToKey,
  updateWeekStartKey,
  updateWeekStartOfKey,
  WEEKDAY_NAMES,
} from "@/lib/tasks/dates";
import { getWeeklySummary, type WeeklyItem } from "@/server/tasks/weekly";

import { itemId, memberOf } from "./ids";
import {
  ConnectorInputError,
  dayArg,
  personOf,
  personRef,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";

/**
 * get_weekly_summary (docs/features/ai-connectors.md): one member's week
 * as the weekly update view drafts it (src/server/tasks/weekly.ts): done,
 * next and blocked. Weeks end on the club's update day, in the club's
 * zone. Reading someone else's week shows what RLS lets this member see
 * of it; their own private tasks are marked, as in their draft.
 */

export const WEEKLY = { feature: "teamwork", section: "tasks" } as const;

const STATUS_OUT: Record<string, "not_started" | "in_progress" | "blocked" | "done"> = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  BLOCKED: "blocked",
  COMPLETED: "done",
};

const weeklyItem = z.object({
  id: z.string().describe("The task's id, for get_task and fetch."),
  title: z.string(),
  status: z.enum(["not_started", "in_progress", "blocked", "done"]),
  due: z.string().nullable(),
  blockedReason: z.string().nullable(),
  role: z.enum(["owner", "collaborator"]).describe("Whether they own it or work on it."),
  partOf: z.string().nullable().describe("The epic or story it's part of."),
  private: z.boolean().describe("Left out when the update is posted to the organization."),
  url: urlField,
});

const output = z.object({
  space: spaceRef,
  member: personRef,
  weekStart: z.string().describe("The week's first day (yyyy-mm-dd)."),
  weekEnd: z.string().describe("The week's last day, the organization's update day."),
  updateDay: z.string().describe("The weekday the organization's updates are due."),
  done: z.array(weeklyItem).describe("Finished during the week."),
  next: z.array(weeklyItem).describe("In progress, or due within a week."),
  blocked: z.array(weeklyItem),
  url: urlField,
});

const input = z.object({
  space: spaceArg,
  week: dayArg
    .optional()
    .describe("Any day in the week (yyyy-mm-dd); the current week unless given."),
  member: z
    .string()
    .max(300)
    .default("me")
    .describe('Whose week: "me" unless given, or a member id from list_members.'),
});

function itemOf(space: ToolSpace, item: WeeklyItem): z.infer<typeof weeklyItem> {
  return {
    id: itemId("task", space.id, item.id),
    title: item.title,
    status: STATUS_OUT[item.status] ?? "not_started",
    due: item.dueKey,
    blockedReason: item.blockedReason,
    role: item.role,
    partOf: item.parentTitle,
    private: item.isPrivate === true,
    url: space.url(`/tasks/${item.id}`),
  };
}

export async function getWeeklySummaryTool(
  session: ConnectorSession,
  raw: z.input<typeof input>,
  now: Date = new Date(),
): Promise<z.infer<typeof output>> {
  const args = input.parse(raw);
  return inSpace(session, args.space, WEEKLY, async (ctx, space) => {
    const userId = memberOf(args.member, space.id, ctx.userId);
    if (!userId) {
      throw new ConnectorInputError(
        'The member is "me" or a member id from list_members for this space.',
      );
    }
    // One after another: a transaction has one connection.
    const membership = await ctx.db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: space.id } },
      select: { user: { select: { id: true, name: true } } },
    });
    if (!membership) throw new NotFoundError();
    const settings = await ctx.db.orgSettings.findUnique({
      where: { organizationId: space.id },
      select: { weeklyUpdateDay: true },
    });
    const updateDay = settings?.weeklyUpdateDay ?? 0;
    // As the updates view: weeks are the club's, and a week not begun reads as this one.
    const current = updateWeekStartKey(now, space.orgZone, updateDay);
    const asked = args.week ? updateWeekStartOfKey(args.week, updateDay) : current;
    const weekStart = asked <= current ? asked : current;
    const summary = await getWeeklySummary(ctx.db, space.id, userId, weekStart, space.orgZone, now);
    return {
      space: { id: space.id, name: space.name },
      member: personOf(space.id, membership.user)!,
      weekStart,
      weekEnd: addDaysToKey(weekStart, 6),
      updateDay: WEEKDAY_NAMES[updateDay] ?? "Sunday",
      done: summary.done.map((i) => itemOf(space, i)),
      next: summary.next.map((i) => itemOf(space, i)),
      blocked: summary.blocked.map((i) => itemOf(space, i)),
      url: space.url(`/tasks?view=updates&week=${weekStart}`),
    };
  });
}

export const registerWeeklyTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "get_weekly_summary",
    {
      title: "Get a weekly summary",
      description:
        "Gets one member's week in an organization, as its weekly update drafts it: what they finished, what is next (in progress or due within a week) and what is blocked. Weeks end on the organization's update day.",
      inputSchema: input,
      outputSchema: output,
      annotations: READ_ONLY,
    },
    (args) => readResult("get_weekly_summary", () => getWeeklySummaryTool(session, args)),
  );
};
