import type { Role } from "@/generated/prisma/client";
import { eventIdOfHref, type AgendaSlot, type DecisionRow } from "@/lib/overview/decisions";
import { localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { countOpenDecisions, listOpenDecisions } from "@/server/decisions/decisions";

/**
 * Decisions (src/components/overview/decisions.tsx): the organization's
 * open decisions (src/server/decisions), each with the next meeting it could
 * go on: a linked meeting still ahead, or else the next meeting in a linked
 * meeting's series (Exec sync on Oct 26 came and went; next Monday's is
 * the one). Its agenda is the meeting's description, so the widget can add
 * the question as a line. Plain data for the client: dates as ISO strings.
 * Reads run one after another on the page's transaction.
 */

const LIMIT = 4;

export interface DecisionsData {
  rows: DecisionRow[];
  /** Every open decision, not just the rows shown. */
  total: number;
  todayKey: string;
  timeZone: string;
}

export async function loadDecisions(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  {
    now,
    timeZone,
    viewer,
    limit = LIMIT,
  }: { now: Date; timeZone: string; viewer: { userId: string; role: Role | null }; limit?: number },
): Promise<DecisionsData> {
  const open = await listOpenDecisions(db, organizationId, {
    limit,
    orgSlug,
    timeZone,
    viewer,
    now,
  });

  // Who raised each (what may settle it), and how many are open in all.
  const raisedBy = open.length
    ? await db.decision.findMany({
        where: { organizationId, id: { in: open.map((d) => d.id) } },
        select: { id: true, createdById: true },
      })
    : [];
  const total = open.length < limit ? open.length : await countOpenDecisions(db, organizationId);

  // The meetings they link to, and what's next in those meetings' series.
  const meetingIds = [
    ...new Set(
      open.flatMap((d) =>
        d.links.filter((l) => l.kind === "meeting").flatMap((l) => eventIdOfHref(l.href) ?? []),
      ),
    ),
  ];
  const select = { id: true, title: true, startsAt: true, seriesId: true, description: true };
  const linked = meetingIds.length
    ? await db.event.findMany({
        where: { organizationId, id: { in: meetingIds }, deletedAt: null },
        select,
      })
    : [];
  const series = [
    ...new Set(linked.flatMap((e) => (e.startsAt < now && e.seriesId ? [e.seriesId] : []))),
  ];
  const ahead = series.length
    ? await db.event.findMany({
        where: {
          organizationId,
          seriesId: { in: series },
          deletedAt: null,
          startsAt: { gte: now },
        },
        select,
        orderBy: { startsAt: "asc" },
        take: 100,
      })
    : [];
  const nextOf = (e: (typeof linked)[number]) =>
    e.startsAt >= now ? e : (ahead.find((a) => a.seriesId === e.seriesId) ?? null);

  const base = `/app/${orgSlug}`;
  const rows = open.map((d): DecisionRow => {
    const ids = d.links.filter((l) => l.kind === "meeting").map((l) => eventIdOfHref(l.href));
    const next = linked
      .filter((e) => ids.includes(e.id))
      .map(nextOf)
      .filter((e) => e !== null)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    const agenda: AgendaSlot | null = next
      ? {
          eventId: next.id,
          title: next.title,
          href: `${base}/meetings/${next.id}`,
          dayKey: localDateKey(next.startsAt, timeZone),
          agenda: next.description ?? "",
          onAgenda: (next.description ?? "")
            .toLowerCase()
            .includes(d.question.trim().toLowerCase()),
        }
      : null;
    return {
      id: d.id,
      question: d.question,
      detail: d.detail,
      owner: d.owner,
      createdById: raisedBy.find((r) => r.id === d.id)?.createdById ?? null,
      createdAt: d.createdAt.toISOString(),
      dueAt: d.dueAt?.toISOString() ?? null,
      links: d.links,
      poll: d.poll
        ? {
            id: d.poll.id,
            title: d.poll.title,
            href: d.poll.href,
            voted: d.poll.voted,
            eligible: d.poll.eligible,
            mine: d.poll.mine,
            open: d.poll.open,
            closesAt: d.poll.closesAt?.toISOString() ?? null,
            options: d.poll.options,
          }
        : null,
      agenda,
    };
  });
  return {
    rows,
    total,
    todayKey: localDateKey(now, timeZone),
    timeZone,
  };
}
