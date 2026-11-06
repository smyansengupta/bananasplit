import type { ItemRef } from "@/lib/overview/types";
import type { DecisionStatus, Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { isPollOpen } from "@/lib/polls/question-poll";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";
import { pollVoteCounts } from "@/server/polls/question-polls";

import { linksOf, refKey, resolveHomeRefs, shortDay } from "./linked-refs";
import { standings, type PollStanding } from "./rules";

/**
 * Decisions, read as the member (RLS): what the organization still has to
 * decide, who owns each, what it came from (meetings, notes, polls, events,
 * through ItemLink) and, when a question poll is linked, how the vote
 * stands. Writes are in ./actions.ts.
 */

/** A member as other members may see them. */
export interface DecisionFace {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

/** A linked question poll and how it stands. */
export interface DecisionPoll {
  id: string;
  title: string;
  href: string;
  /** How many members have voted. */
  voted: number;
  /** How many members could vote (everyone in the organization). */
  eligible: number;
  /** Whether the viewer has voted. */
  mine: boolean;
  /** Still taking votes. */
  open: boolean;
  closesAt: Date | null;
  /**
   * Each option with its votes and share of the voters, leader first.
   * Empty while the poll hides its results from this viewer until it closes.
   */
  options: PollStanding[];
}

export interface OpenDecision {
  id: string;
  question: string;
  detail: string | null;
  status: DecisionStatus;
  /** Null while nobody has taken it. */
  owner: DecisionFace | null;
  createdAt: Date;
  dueAt: Date | null;
  /** What it links to, as chips: "Exec sync, Oct 26", a note, the poll. */
  links: ItemRef[];
  /** The first linked question poll (an open one when there is one), or null. */
  poll: DecisionPoll | null;
}

export interface ListDecisionsOptions {
  /** At most this many (default 5). */
  limit?: number;
  /** For the chips' links; read from the organization when left out. */
  orgSlug?: string;
  /** For meeting dates on chips; the organization's when left out. */
  timeZone?: string;
  /**
   * Who is looking: whether they voted, and whether a poll that hides its
   * results until it closes shows them (its creator, owners and admins).
   */
  viewer?: { userId: string; role: Role | null };
  now?: Date;
}

/**
 * The organization's open decisions: the ones with a due date first
 * (soonest first), then the newest. Each with its owner, its links as the
 * viewer can see them, and its linked poll's standings.
 */
export async function listOpenDecisions(
  db: TxClient,
  orgId: string,
  { limit = 5, orgSlug, timeZone, viewer, now = new Date() }: ListDecisionsOptions = {},
): Promise<OpenDecision[]> {
  const rows = await db.decision.findMany({
    where: { organizationId: orgId, status: "OPEN" },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
    take: Math.max(1, Math.min(limit, 50)),
    select: {
      id: true,
      question: true,
      detail: true,
      status: true,
      createdAt: true,
      dueAt: true,
      owner: { select: userPublicSelect },
    },
  });
  if (rows.length === 0) return [];

  // One query at a time: a transaction has one connection.
  const org =
    orgSlug === undefined || timeZone === undefined
      ? await db.organization.findUnique({
          where: { id: orgId },
          select: { slug: true, timezone: true },
        })
      : null;
  const slug = orgSlug ?? org?.slug ?? "";
  const zone = timeZone ?? org?.timezone ?? "UTC";
  const linked = await linksOf(
    db,
    orgId,
    "decision",
    rows.map((r) => r.id),
  );
  const resolved = await resolveHomeRefs(db, orgId, slug, [...linked.values()].flat());

  // The poll for each decision: the first linked one still open, else the first.
  const pollFor = new Map<string, string>();
  const pollIds = [
    ...new Set(
      [...linked.values()]
        .flat()
        .flatMap((r) => (r.kind === "poll" && resolved.has(refKey(r)) ? [r.id] : [])),
    ),
  ];
  const polls = pollIds.length
    ? await db.poll.findMany({
        where: { organizationId: orgId, id: { in: pollIds } },
        select: {
          id: true,
          question: true,
          closesAt: true,
          closedAt: true,
          hideResultsUntilClosed: true,
          createdById: true,
        },
      })
    : [];
  for (const r of rows) {
    const mine = (linked.get(r.id) ?? []).filter((l) => l.kind === "poll");
    const found = mine.map((l) => polls.find((p) => p.id === l.id)).filter((p) => p !== undefined);
    const pick = found.find((p) => isPollOpen(p, now)) ?? found[0];
    if (pick) pollFor.set(r.id, pick.id);
  }
  const used = polls.filter((p) => [...pollFor.values()].includes(p.id));
  const options = used.length
    ? await db.pollOption.findMany({
        where: { organizationId: orgId, pollId: { in: used.map((p) => p.id) } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, pollId: true, label: true },
      })
    : [];
  const counts = await pollVoteCounts(
    db,
    used.map((p) => p.id),
  );
  const myVotes =
    used.length && viewer
      ? await db.pollVote.findMany({
          where: {
            organizationId: orgId,
            pollId: { in: used.map((p) => p.id) },
            userId: viewer.userId,
          },
          select: { pollId: true },
          distinct: ["pollId"],
        })
      : [];
  const eligible = used.length
    ? await db.membership.count({ where: { organizationId: orgId } })
    : 0;

  const pollViews = new Map<string, DecisionPoll>();
  for (const p of used) {
    const open = isPollOpen(p, now);
    const manages = viewer ? p.createdById === viewer.userId || can(viewer, "events.write") : false;
    const visible = !open || !p.hideResultsUntilClosed || manages;
    const mineCounts = counts.filter((c) => c.pollId === p.id);
    const voters = mineCounts[0]?.voters ?? 0;
    pollViews.set(p.id, {
      id: p.id,
      title: p.question,
      href: `/app/${slug}/forms/polls/${p.id}`,
      voted: voters,
      eligible,
      mine: myVotes.some((v) => v.pollId === p.id),
      open,
      closesAt: p.closesAt,
      options: visible
        ? standings(
            options.filter((o) => o.pollId === p.id),
            mineCounts,
            voters,
          )
        : [],
    });
  }

  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    detail: r.detail,
    status: r.status,
    owner: r.owner,
    createdAt: r.createdAt,
    dueAt: r.dueAt,
    links: (linked.get(r.id) ?? []).flatMap((l) => {
      const hit = resolved.get(refKey(l));
      if (!hit) return [];
      // A meeting or event says which one: "Exec sync, Oct 26".
      const label = hit.startsAt ? `${hit.title}, ${shortDay(hit.startsAt, zone)}` : hit.title;
      return [{ ...hit.ref, label }];
    }),
    poll: pollFor.has(r.id) ? (pollViews.get(pollFor.get(r.id)!) ?? null) : null,
  }));
}

/** How many decisions are still open (the widget's count). */
export function countOpenDecisions(db: TxClient, orgId: string): Promise<number> {
  return db.decision.count({ where: { organizationId: orgId, status: "OPEN" } });
}
