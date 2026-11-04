import { pickTaskStep, type LinkedTaskRow, type TaskStep } from "@/lib/crm/task-steps";
import type { TxClient } from "@/server/db/context";
import { readLinks } from "@/server/links/links";

/**
 * Each record's next step from its linked tasks (src/lib/crm/task-steps.ts):
 * the ItemLink rows between tasks and these CRM records, either way round,
 * then the open tasks among them, read as the viewer (a private task they
 * can't see doesn't count for them). Two reads, however many records.
 */
export async function taskSteps(
  db: TxClient,
  organizationId: string,
  kind: "person" | "company" | "deal",
  ids: readonly string[],
): Promise<Map<string, TaskStep>> {
  const out = new Map<string, TaskStep>();
  if (!ids.length) return out;
  const linkKind = `crm-${kind}` as const;
  const links = await readLinks(
    db,
    organizationId,
    ids.map((id) => ({ kind: linkKind, id })),
    { otherKinds: ["task"], take: 2000 },
  );
  if (!links.length) return out;
  const taskIds = [...new Set(links.map((l) => l.other.id))];
  const tasks = await db.task.findMany({
    where: {
      organizationId,
      id: { in: taskIds },
      deletedAt: null,
      completedAt: null,
      status: { not: "COMPLETED" },
    },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      completedAt: true,
      deletedAt: true,
      createdAt: true,
    },
  });
  const byId = new Map(tasks.map((t) => [t.id, t as LinkedTaskRow]));
  const perRecord = new Map<string, LinkedTaskRow[]>();
  for (const l of links) {
    const task = byId.get(l.other.id);
    if (!task) continue;
    const recordId = l.at.slice(linkKind.length + 1);
    perRecord.set(recordId, [...(perRecord.get(recordId) ?? []), task]);
  }
  for (const [recordId, rows] of perRecord) {
    const step = pickTaskStep(rows);
    if (step) out.set(recordId, step);
  }
  return out;
}
