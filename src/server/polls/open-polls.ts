import type { TxClient } from "@/server/db/context";

/** A poll still taking answers, of either kind (the Overview's "Open polls"). */
export interface OpenPoll {
  id: string;
  kind: "question" | "availability";
  title: string;
  closesAt: Date | null;
}

/**
 * The newest `limit` open polls: questions not closed and not past their
 * closing time, and availability polls not yet scheduled or closed. Read as
 * the member (RLS), one query after the other.
 */
export async function listOpenPolls(
  db: TxClient,
  organizationId: string,
  now: Date,
  limit = 5,
): Promise<OpenPoll[]> {
  const stillOpen = { OR: [{ closesAt: null }, { closesAt: { gt: now } }] };
  const availability = await db.availabilityPoll.findMany({
    where: { organizationId, finalizedEventId: null, ...stillOpen },
    select: { id: true, title: true, closesAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const questions = await db.poll.findMany({
    where: { organizationId, closedAt: null, ...stillOpen },
    select: { id: true, question: true, closesAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return [
    ...availability.map((p) => ({ ...p, kind: "availability" as const })),
    ...questions.map((p) => ({
      id: p.id,
      title: p.question,
      closesAt: p.closesAt,
      createdAt: p.createdAt,
      kind: "question" as const,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(({ id, kind, title, closesAt }) => ({ id, kind, title, closesAt }));
}
