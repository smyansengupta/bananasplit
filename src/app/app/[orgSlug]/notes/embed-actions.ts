"use server";

import { z } from "zod";

import { withOrgAction } from "@/server/db/context";

/**
 * What the note editor's live pieces read (Moonstone 13.2): the tasks behind
 * task chips, and the databases and polls a link card can open. Read as
 * the member under RLS, so a chip for a task they can't see says so, and
 * the pickers list only what they could open anyway.
 */

const readAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options });

const idsSchema = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100);

export interface TaskChipData {
  id: string;
  title: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED";
  dueDate: string | null;
  assignee: { id: string; name: string | null; image: string | null } | null;
}

/** The tasks behind the chips in a note (missing ones are simply absent). */
export const loadTaskChips = readAction(
  async (ctx, taskIds: unknown): Promise<{ tasks: TaskChipData[] }> => {
    const parsed = idsSchema.safeParse(taskIds);
    if (!parsed.success || parsed.data.length === 0) return { tasks: [] };
    const rows = await ctx.db.task.findMany({
      where: { organizationId: ctx.organizationId, id: { in: parsed.data }, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        assignees: {
          select: { user: { select: { id: true, name: true, image: true } } },
          take: 1,
        },
      },
    });
    return {
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
        assignee: t.assignees[0]?.user ?? null,
      })),
    };
  },
);

export interface EmbedTarget {
  kind: "database" | "poll";
  path: string;
  title: string;
}

/** The databases and polls a link card may open. */
export const listEmbedTargets = readAction(async (ctx): Promise<{ targets: EmbedTarget[] }> => {
  // One transaction: one query at a time.
  const databases = await ctx.db.databaseDefinition.findMany({
    where: { organizationId: ctx.organizationId, archivedAt: null },
    select: { key: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 100,
  });
  const polls = await ctx.db.poll.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, question: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    targets: [
      ...databases.map((d) => ({
        kind: "database" as const,
        path: `databases/${encodeURIComponent(d.key)}`,
        title: d.name,
      })),
      ...polls.map((p) => ({
        kind: "poll" as const,
        path: `calendar/polls/${encodeURIComponent(p.id)}`,
        title: p.question,
      })),
    ],
  };
});
