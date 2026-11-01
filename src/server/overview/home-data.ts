import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import type { TxClient } from "@/server/db/context";
import type { PollOption } from "@/server/databases/ballot-results";
import { isFormOpen } from "@/server/forms/forms";
import type { OpenPoll } from "@/server/polls/open-polls";

/**
 * The reads several of Home's widgets share, made once on the page's main
 * transaction (src/app/app/[orgSlug]/page.tsx) and handed to each loader,
 * as memberCount is: what's open in Forms (forms, quick polls, elections),
 * the member polls still taking votes, and which forms the viewer answered.
 * Each is filtered in SQL to what's open now and bounded. Read as the
 * member (RLS), one query at a time.
 */

/** At most this many of each open thing (Home shows a handful). */
const OPEN_LIMIT = 30;

/** An open form or quick poll, with its counts as the viewer can read them. */
export interface OpenForm {
  id: string;
  kind: "FORM" | "QUICK_POLL";
  title: string;
  anonymous: boolean;
  closesAt: Date | null;
  createdAt: Date;
  /** Responses the viewer can read (none for a member, RLS). */
  responses: number;
  /** Responses waiting on a review, where the form has one. */
  toReview: number;
  /** Members-only forms: how many members there are ("36 of 40"). */
  members: number | null;
}

/** An open election (BallotDefinition, never a test one), with its ballots as the viewer can read them. */
export interface OpenElection extends PollOption {
  createdAt: Date;
  responses: number;
  /** The Ballots database, where its results open. */
  databaseKey: string | null;
}

/** A member poll still taking votes. */
export interface OpenQuestion {
  id: string;
  question: string;
  closesAt: Date | null;
  createdAt: Date;
  /** Moved into a form (its page opens the form): Votes and Deadlines leave it to the form. */
  formId: string | null;
  hideResultsUntilClosed: boolean;
}

/** A Find a time poll not yet scheduled or closed. */
export interface OpenAvailability {
  id: string;
  title: string;
  closesAt: Date | null;
  createdAt: Date;
}

/** One of the viewer's open tasks with a due date, from the page's own read. */
export interface DueTaskRow {
  id: string;
  title: string;
  dueDate: Date | null;
  status: TaskStatus;
  priority: TaskPriority;
}

/** What the page reads once and hands to the widgets. */
export interface HomeShared {
  memberCount: number;
  forms: OpenForm[];
  elections: OpenElection[];
  questions: OpenQuestion[];
  availability: OpenAvailability[];
  /** Forms the viewer has answered (their own responses). */
  answered: Set<string>;
  /** The viewer's open tasks due within four weeks, late ones first. */
  myDue: DueTaskRow[];
}

const stillOpen = (now: Date) => ({ OR: [{ closesAt: null }, { closesAt: { gt: now } }] });

/**
 * Forms and quick polls taking answers: published, not closed, not past
 * their closing time (in SQL), and not full (the cap needs the count).
 * Newest first.
 */
export async function listOpenForms(
  db: TxClient,
  organizationId: string,
  now: Date,
  memberCount: number,
): Promise<OpenForm[]> {
  const forms = await db.form.findMany({
    where: {
      organizationId,
      deletedAt: null,
      closedAt: null,
      publishedAt: { not: null },
      ...stillOpen(now),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      access: true,
      anonymous: true,
      responseCap: true,
      review: true,
      closesAt: true,
      closedAt: true,
      publishedAt: true,
      deletedAt: true,
      createdAt: true,
    },
    take: OPEN_LIMIT,
  });
  if (forms.length === 0) return [];
  const ids = forms.map((f) => f.id);
  const all = await db.formResponse.groupBy({
    by: ["formId"],
    where: { organizationId, formId: { in: ids }, record: { deletedAt: null } },
    _count: { _all: true },
  });
  const reviewed = forms.filter((f) => f.review).map((f) => f.id);
  const fresh = reviewed.length
    ? await db.formResponse.groupBy({
        by: ["formId"],
        where: {
          organizationId,
          formId: { in: reviewed },
          status: "NEW",
          record: { deletedAt: null },
        },
        _count: { _all: true },
      })
    : [];
  return forms.flatMap((form) => {
    const responses = all.find((c) => c.formId === form.id)?._count._all ?? 0;
    if (!isFormOpen(form, responses, now)) return [];
    return [
      {
        id: form.id,
        kind: form.kind,
        title: form.title,
        anonymous: form.anonymous,
        closesAt: form.closesAt,
        createdAt: form.createdAt,
        responses,
        toReview: fresh.find((c) => c.formId === form.id)?._count._all ?? 0,
        members: form.access === "MEMBERS" ? memberCount : null,
      },
    ];
  });
}

/** Elections open now (opened, or no start, and not yet closed), never a test one. */
export async function listOpenElections(
  db: TxClient,
  organizationId: string,
  now: Date,
): Promise<OpenElection[]> {
  const polls = await db.ballotDefinition.findMany({
    where: {
      organizationId,
      isTest: false,
      AND: [{ OR: [{ opensAt: null }, { opensAt: { lte: now } }] }, stillOpen(now)],
    },
    orderBy: [{ opensAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      isTest: true,
      opensAt: true,
      closesAt: true,
      linkedEventId: true,
      createdAt: true,
    },
    take: OPEN_LIMIT,
  });
  if (polls.length === 0) return [];
  const counts = await db.ballot.groupBy({
    by: ["ballotDefinitionId"],
    where: {
      organizationId,
      ballotDefinitionId: { in: polls.map((p) => p.id) },
      excludedReason: null,
    },
    _count: { _all: true },
  });
  const ballots = await db.databaseDefinition.findFirst({
    where: { organizationId, kind: "BALLOTS" },
    select: { key: true },
  });
  return polls.map((p) => ({
    ...p,
    responses: counts.find((c) => c.ballotDefinitionId === p.id)?._count._all ?? 0,
    databaseKey: ballots?.key ?? null,
  }));
}

/** Member polls and Find a time polls still taking answers, newest first. */
export async function listOpenMemberPolls(
  db: TxClient,
  organizationId: string,
  now: Date,
): Promise<{ questions: OpenQuestion[]; availability: OpenAvailability[] }> {
  const availability = await db.availabilityPoll.findMany({
    where: { organizationId, finalizedEventId: null, ...stillOpen(now) },
    select: { id: true, title: true, closesAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: OPEN_LIMIT,
  });
  const questions = await db.poll.findMany({
    where: { organizationId, closedAt: null, ...stillOpen(now) },
    select: {
      id: true,
      question: true,
      closesAt: true,
      createdAt: true,
      formId: true,
      hideResultsUntilClosed: true,
    },
    orderBy: { createdAt: "desc" },
    take: OPEN_LIMIT,
  });
  return { questions, availability };
}

/** Which of `formIds` the viewer has answered (their own responses). */
export async function answeredForms(
  db: TxClient,
  organizationId: string,
  userId: string,
  formIds: readonly string[],
): Promise<Set<string>> {
  if (formIds.length === 0) return new Set();
  const rows = await db.formResponse.findMany({
    where: { organizationId, userId, formId: { in: [...formIds] } },
    select: { formId: true },
    distinct: ["formId"],
  });
  return new Set(rows.map((r) => r.formId));
}

/** As a member poll is listed: Up next's and Open forms' shape. */
export function asOpenPoll(p: OpenQuestion | OpenAvailability): OpenPoll {
  return "question" in p
    ? {
        id: p.id,
        kind: "question",
        title: p.question,
        closesAt: p.closesAt,
        createdAt: p.createdAt,
      }
    : {
        id: p.id,
        kind: "availability",
        title: p.title,
        closesAt: p.closesAt,
        createdAt: p.createdAt,
      };
}

/** The newest `limit` open polls of either kind (what Up next asks about). */
export function newestPolls(shared: Pick<HomeShared, "questions" | "availability">, limit: number) {
  return [...shared.availability, ...shared.questions]
    .map(asOpenPoll)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}
