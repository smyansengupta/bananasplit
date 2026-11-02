import type { BallotVisibility, Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import type { Deadlines } from "@/lib/overview/deadlines-text";
import type { WaitingOnOthers } from "@/lib/overview/waiting-on-others-text";
import { withOrgTx, type TxClient } from "@/server/db/context";
import type { RecentItem } from "@/server/pins";

import { loadDecisions, type DecisionsData } from "./decisions";
import { loadDeadlines } from "./deadlines";
import { loadHereNow, type HereNowData } from "./here-now";
import {
  answeredForms,
  listOpenElections,
  listOpenForms,
  listOpenMemberPolls,
  newestPolls,
  asOpenPoll,
  type DueTaskRow,
  type HomeShared,
} from "./home-data";
import { loadPollStats, type PollStat } from "./queries";
import { loadQuickCapture, type QuickCaptureData } from "./quick-capture";
import { loadSinceYouWereHere, type SinceYouWereHereData } from "./since-you-were-here";
import { loadVotes, votePolls, type VotesData } from "./votes";
import { loadWaitingOnOthers } from "./waiting-on-others";
import { loadWaitingOnYou } from "./waiting-on-you";
import { loadWhoOwnsWhat, type WhoOwnsWhatData } from "./who-owns-what";

/**
 * Loading Home's newer widgets for src/app/app/[orgSlug]/page.tsx, so the
 * page reads as layout. Three parts:
 *
 * - readHomeShared: what several widgets share (open forms, elections,
 *   member polls and their turnout), read once on the page's transaction.
 * - loadMainWidgets: the cheap widgets (Here now, Quick capture, Focus
 *   time, Deadlines), on that same transaction, after everything else, from
 *   the shared reads. Each is caught on its own: a failure loses its card.
 * - loadOwnTxWidgets: the rest, each in its own transaction, one after
 *   another (never in parallel: one connection at a time per page), so a
 *   failing widget loses its own card, not the page.
 *
 * Only widgets on this member's board are read (`placed`).
 */

/** Up next asks about this many open polls. */
export const UP_NEXT_POLLS = 5;
/** Votes shows this many member polls. */
const VOTE_POLLS = 4;
/** Deadlines looks this far ahead for member polls closing. */
const DEADLINE_MS = 21 * 86_400_000;

export interface HomeSharedInput {
  orgId: string;
  userId: string;
  now: Date;
  memberCount: number;
  myDue: DueTaskRow[];
}

/** HomeShared, plus each open poll's turnout and whether the viewer answered, by poll id. */
export interface HomeReads extends HomeShared {
  pollStats: Map<string, PollStat>;
  /** The newest open polls, counted, for Up next and Open forms. */
  upNextPolls: PollStat[];
}

export async function readHomeShared(db: TxClient, input: HomeSharedInput): Promise<HomeReads> {
  const { orgId, userId, now, memberCount } = input;
  const forms = await listOpenForms(db, orgId, now, memberCount);
  const elections = await listOpenElections(db, orgId, now);
  const { questions, availability } = await listOpenMemberPolls(db, orgId, now);
  const answered = await answeredForms(
    db,
    orgId,
    userId,
    forms.map((f) => f.id),
  );
  const shared: HomeShared = {
    memberCount,
    forms,
    elections,
    questions,
    availability,
    answered,
    myDue: input.myDue,
  };
  // Turnout once for every poll a widget shows: Up next's, Votes' and the
  // member polls closing within Deadlines' window.
  const upNext = newestPolls(shared, UP_NEXT_POLLS);
  const until = now.getTime() + DEADLINE_MS;
  const counted = new Map(upNext.map((p) => [p.id, p]));
  for (const q of [
    ...votePolls(shared).slice(0, VOTE_POLLS),
    ...questions.filter((q) => !q.formId && q.closesAt && q.closesAt.getTime() <= until),
  ]) {
    if (!counted.has(q.id)) counted.set(q.id, asOpenPoll(q));
  }
  const stats = await loadPollStats(db, orgId, userId, [...counted.values()], memberCount);
  const pollStats = new Map(stats.map((s) => [s.id, s]));
  return {
    ...shared,
    pollStats,
    upNextPolls: upNext.flatMap((p) => pollStats.get(p.id) ?? []),
  };
}

/** Who is looking, and when. */
export interface WidgetViewer {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  timeZone: string;
  orgTimeZone: string;
  now: Date;
}

/** Runs one widget's read, or says it failed (logged); undefined either way when it isn't placed. */
async function guarded<T>(
  type: string,
  placed: ReadonlySet<string>,
  load: () => Promise<T> | T,
): Promise<T | undefined> {
  if (!placed.has(type)) return undefined;
  try {
    return await load();
  } catch (error: unknown) {
    console.error(`Overview widget "${type}" failed to load`, error);
    return undefined;
  }
}

/** The same, in a transaction of its own. */
function readWidget<T>(
  orgId: string,
  type: string,
  placed: ReadonlySet<string>,
  load: (db: TxClient) => Promise<T>,
): Promise<T | undefined> {
  return guarded(type, placed, () => withOrgTx(orgId, ({ db }) => load(db)));
}

export interface MainWidgets {
  hereNow?: HereNowData;
  capture?: QuickCaptureData;
  deadlines?: Deadlines;
}

/**
 * The cheap widgets, on the page's own transaction: last, so nothing the
 * page needs comes after a read that failed.
 */
export async function loadMainWidgets(
  db: TxClient,
  placed: ReadonlySet<string>,
  viewer: WidgetViewer,
  {
    shared,
    upcoming,
    recent,
  }: {
    shared: HomeReads;
    /** What's coming up, soonest first (the page's getUpcomingEvents read). */
    upcoming: readonly { id: string; title: string; startsAt: Date; allDay: boolean }[];
    /** The pages the viewer opened lately (the page's listRecent read). */
    recent: readonly RecentItem[];
  },
): Promise<MainWidgets> {
  const { orgId, orgSlug, now, timeZone, orgTimeZone } = viewer;
  const hereNow = await guarded("here-now", placed, () => loadHereNow(orgSlug, { recent, now }));
  const capture = await guarded("quick-capture", placed, () =>
    loadQuickCapture({ upcoming, now, timeZone, orgTimeZone }),
  );
  const deadlines = await guarded("deadlines", placed, async () =>
    loadDeadlines({
      orgSlug,
      role: viewer.role,
      timeZone,
      now,
      shared,
      voters: new Map([...shared.pollStats].map(([id, s]) => [id, s.voters])),
      // The budget period's last day is for finance roles only.
      budgetPeriod: can({ role: viewer.role }, "finance.manage")
        ? await db.budgetPeriod.findFirst({
            where: { organizationId: orgId, isActive: true },
            select: { id: true, label: true, endsOn: true },
          })
        : null,
    }),
  );
  return { hereNow, capture, deadlines };
}

export interface OwnTxWidgets {
  since?: SinceYouWereHereData;
  waitingOnYou?: Awaited<ReturnType<typeof loadWaitingOnYou>>;
  waitingOnOthers?: WaitingOnOthers;
  votes?: VotesData;
  decisions?: DecisionsData;
  owners?: WhoOwnsWhatData | null;
}

/** The widgets that read more, each in its own transaction, one after another. */
export async function loadOwnTxWidgets(
  placed: ReadonlySet<string>,
  viewer: WidgetViewer,
  {
    shared,
    since,
    upcoming,
    todayKey,
    ballotVisibility,
  }: {
    shared: HomeReads;
    /** The previous visit (markHomeVisit), what Since you were here counts from. */
    since: Date | null;
    upcoming: readonly { id: string; title: string; startsAt: Date }[];
    todayKey: string;
    ballotVisibility: BallotVisibility | null | undefined;
  },
): Promise<OwnTxWidgets> {
  const { orgId, orgSlug, userId, role, timeZone, now } = viewer;
  const who = { orgId, orgSlug, userId, role, timeZone, now };
  const read = <T>(type: string, load: (db: TxClient) => Promise<T>) =>
    readWidget(orgId, type, placed, load);
  return {
    since: await read("since-you-were-here", (db) => loadSinceYouWereHere(db, { ...who, since })),
    waitingOnYou: await read("waiting-on-you", (db) =>
      loadWaitingOnYou(db, { ...who, orgTimeZone: viewer.orgTimeZone }),
    ),
    waitingOnOthers: await read("waiting-on-others", (db) => loadWaitingOnOthers(db, who)),
    votes: await read("votes", (db) =>
      loadVotes(db, { ...who, shared, stats: shared.pollStats, ballotVisibility }),
    ),
    decisions: await read("decisions", (db) =>
      loadDecisions(db, orgId, orgSlug, { now, timeZone, viewer: { userId, role } }),
    ),
    owners: await read("who-owns-what", (db) =>
      loadWhoOwnsWhat(db, orgId, orgSlug, { now, todayKey, timeZone, upcoming }),
    ),
  };
}
