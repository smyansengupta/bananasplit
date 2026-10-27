import "server-only";

import { z } from "zod";

import {
  addDaysToKey,
  fromDateKey,
  updateWeekStartKey,
  updateWeekStartOfKey,
} from "@/lib/tasks/dates";
import { loadTaskEnv, TaskError } from "@/server/tasks/service";
import { postWeeklyUpdate, storedLines } from "@/server/tasks/weekly";

import {
  dayArg,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import { zonedIso } from "./text";
import { WEEKLY } from "./weekly";
import { ADDS, refuseOn, WriteRefusedError, writeInSpace } from "./write";

/**
 * post_weekly_update (docs/features/ai-connectors.md, Phase 3): the member
 * posts their own week, as the updates view's Post button does
 * (postWeeklyUpdate, src/server/tasks/weekly.ts). It snapshots what they
 * finished, what is next and what is blocked, leaving their private tasks
 * out, with an optional note. Posting a week again replaces that week's
 * post, as in the app. Clubs only: Personal has no team.
 */

/** Additive, and posting the same week again leaves the same post. */
const POSTS = { ...ADDS, idempotentHint: true };

const postInput = z.object({
  space: spaceArg,
  week: dayArg
    .optional()
    .describe("Any day in the week (yyyy-mm-dd); the current week unless given."),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe("A note for the club, posted with the lists."),
});

const postOutput = z.object({
  space: spaceRef,
  weekStart: z.string().describe("The week's first day (yyyy-mm-dd)."),
  weekEnd: z.string().describe("The week's last day, the club's update day."),
  done: z.array(z.string()).describe("What the post lists as finished."),
  next: z.array(z.string()),
  blocked: z.array(z.string()),
  note: z.string().nullable(),
  postedAt: z.string(),
  url: urlField,
});

export async function postWeeklyUpdateTool(
  session: ConnectorSession,
  raw: z.input<typeof postInput>,
  now: Date = new Date(),
): Promise<z.infer<typeof postOutput>> {
  const args = postInput.parse(raw);
  return writeInSpace(session, "post_weekly_update", args.space, WEEKLY, async (ctx, space) => {
    const env = await loadTaskEnv(ctx, now);
    const updateDay = env.org.weeklyUpdateDay;
    const weekStart = args.week
      ? updateWeekStartOfKey(args.week, updateDay)
      : updateWeekStartKey(now, space.orgZone, updateDay);
    try {
      refuseOn(await postWeeklyUpdate(env, { weekStart, note: args.note || null }));
    } catch (error) {
      if (error instanceof TaskError) throw new WriteRefusedError(error.message);
      throw error;
    }
    const post = await ctx.db.weeklyUpdate.findUniqueOrThrow({
      where: {
        organizationId_userId_weekStart: {
          organizationId: space.id,
          userId: ctx.userId,
          weekStart: fromDateKey(weekStart),
        },
      },
      select: { id: true, done: true, next: true, blocked: true, note: true, postedAt: true },
    });
    return {
      output: {
        space: { id: space.id, name: space.name },
        weekStart,
        weekEnd: addDaysToKey(weekStart, 6),
        done: storedLines(post.done),
        next: storedLines(post.next),
        blocked: storedLines(post.blocked),
        note: post.note,
        postedAt: zonedIso(post.postedAt ?? now, space.zone),
        url: space.url(`/tasks?view=updates&week=${weekStart}`),
      },
      target: { type: "WeeklyUpdate", id: post.id },
    };
  });
}

export const registerWeeklyWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "post_weekly_update",
    {
      title: "Post a weekly update",
      description:
        "Posts the member's own weekly update in a club, as get_weekly_summary drafts it: what they finished, what is next and what is blocked, with an optional note. Private tasks are left out. Posting a week again replaces that week's post.",
      inputSchema: postInput,
      outputSchema: postOutput,
      annotations: POSTS,
    },
    (args) => readResult("post_weekly_update", () => postWeeklyUpdateTool(session, args)),
  );
};
