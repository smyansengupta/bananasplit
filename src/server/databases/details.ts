import type { Prisma } from "@/generated/prisma/client";
import { writeOrgAuditLog } from "@/server/audit";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

import { definitionLabels, readDefinition } from "./ballot-definitions";
import { peopleRowId } from "./sources/people";
import type { ViewContext } from "./types";

/**
 * Row drawer loaders (?row=). Each runs in the page's withOrgTx, the same
 * RLS-scoped path as the table: a deep link to a row the viewer may not see
 * finds nothing, and the page answers notFound().
 */

const contactDetailSelect = {
  id: true,
  displayName: true,
  emailMasked: true,
  emailDomain: true,
  userId: true,
  unsubscribedAt: true,
  firstSeenAt: true,
  sessionsAttended: true,
  firstCheckInAt: true,
  lastCheckInAt: true,
  lapsedSince: true,
  user: { select: userPublicSelect },
  // Row-gated by RLS (CONTACT_EMAIL): empty for viewers without access.
  emails: { select: { id: true, emailNormalized: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
} satisfies Prisma.ContactSelect;

export type ContactDetail = Prisma.ContactGetPayload<{ select: typeof contactDetailSelect }>;

export interface CheckInHistoryItem {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStartsAt: Date;
  checkedInAt: Date;
  method: string;
  term: string;
  stampNumber: number | null;
  suppressed: boolean;
}

export interface ContactPanel {
  contact: ContactDetail;
  history: CheckInHistoryItem[];
  terms: { term: string; sessionsAttended: number; stampCount: number }[];
  signups: { id: string; term: string | null; status: string; signedUpAt: Date }[];
}

/** A contact with its check-in history, per-term stats and signups (each part under its own RLS). */
export async function loadContactPanel(db: TxClient, organizationId: string, contactId: string): Promise<ContactPanel | null> {
  const contact = await db.contact.findFirst({ where: { id: contactId, organizationId }, select: contactDetailSelect });
  if (!contact) return null;
  const [history, terms, signups] = [
    await db.attendance.findMany({
      where: { organizationId, contactId },
      orderBy: [{ checkedInAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        checkedInAt: true,
        method: true,
        term: true,
        stampNumber: true,
        suppressedAt: true,
        event: { select: { id: true, title: true, startsAt: true } },
      },
    }),
    await db.contactTermStats.findMany({
      where: { organizationId, contactId },
      orderBy: { term: "desc" },
      select: { term: true, sessionsAttended: true, stampCount: true },
    }),
    await db.signup.findMany({
      where: { organizationId, contactId },
      orderBy: { signedUpAt: "desc" },
      select: { id: true, term: true, status: true, signedUpAt: true },
    }),
  ];
  return {
    contact,
    history: history.map((h) => ({
      id: h.id,
      eventId: h.event.id,
      eventTitle: h.event.title,
      eventStartsAt: h.event.startsAt,
      checkedInAt: h.checkedInAt,
      method: h.method,
      term: h.term,
      stampNumber: h.stampNumber,
      suppressed: h.suppressedAt !== null,
    })),
    terms,
    signups,
  };
}

/** The term's sessions with the ones this contact attended marked: the stamp-card strip. */
export async function loadStampStrip(
  db: TxClient,
  organizationId: string,
  contactId: string,
  term: string,
): Promise<{ slot: number; title: string; startsAt: Date; stamped: boolean }[]> {
  const events = await db.event.findMany({
    where: { organizationId, term, deletedAt: null, mergedIntoId: null, OR: [{ stampSlot: { not: null } }, { attendanceCount: { gt: 0 } }] },
    orderBy: [{ startsAt: "asc" }],
    select: { id: true, title: true, startsAt: true, stampSlot: true },
    take: 40,
  });
  const attended = new Set(
    (
      await db.attendance.findMany({
        where: { organizationId, contactId, term, suppressedAt: null },
        select: { eventId: true },
      })
    ).map((a) => a.eventId),
  );
  // The website's slot numbers when they are consistent, otherwise positions.
  const slots = events.map((e) => e.stampSlot);
  const useSlots = slots.every((s) => s !== null) && new Set(slots).size === slots.length;
  return events.map((e, i) => ({
    slot: useSlots ? (e.stampSlot as number) : i + 1,
    title: e.title,
    startsAt: e.startsAt,
    stamped: attended.has(e.id),
  }));
}

// ---- Per database --------------------------------------------------------------

export async function loadSessionDetail(db: TxClient, ctx: ViewContext, eventId: string) {
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null, mergedIntoId: null },
    select: {
      id: true,
      title: true,
      description: true,
      kind: true,
      visibility: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      location: true,
      hostUserId: true,
      hostName: true,
      rsvpUrl: true,
      term: true,
      stampSlot: true,
      attendanceCount: true,
      sourceSessionId: true,
      needsReview: true,
      suiteEditedAt: true,
      googleHtmlLink: true,
      createdById: true,
      host: { select: userPublicSelect },
    },
  });
  if (!event) return null;
  const attendees = await db.attendance.findMany({
    where: { organizationId: ctx.organizationId, eventId },
    orderBy: [{ checkedInAt: "asc" }, { id: "asc" }],
    take: 500,
    select: {
      id: true,
      checkedInAt: true,
      method: true,
      stampNumber: true,
      suppressedAt: true,
      nameOverride: true,
      contact: {
        select: { id: true, displayName: true, emailMasked: true, userId: true, user: { select: userPublicSelect } },
      },
    },
  });
  const links =
    ctx.tier === "MEMBER"
      ? []
      : await db.eventLinkLog.findMany({
          where: { organizationId: ctx.organizationId, eventId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, source: true, method: true, score: true, createdAt: true },
        });
  return { event, attendees, links };
}

export type SessionDetail = NonNullable<Awaited<ReturnType<typeof loadSessionDetail>>>;

export async function loadAttendanceDetail(db: TxClient, ctx: ViewContext, attendanceId: string) {
  const row = await db.attendance.findFirst({
    where: { id: attendanceId, organizationId: ctx.organizationId },
    select: {
      id: true,
      checkedInAt: true,
      method: true,
      term: true,
      stampNumber: true,
      termStampTotal: true,
      isFirstVisit: true,
      source: true,
      suppressedAt: true,
      nameAsEntered: true,
      nameOverride: true,
      createdAt: true,
      contactId: true,
      event: { select: { id: true, title: true, startsAt: true } },
    },
  });
  if (!row) return null;
  const panel = await loadContactPanel(db, ctx.organizationId, row.contactId);
  if (!panel) return null;
  const strip = await loadStampStrip(db, ctx.organizationId, row.contactId, row.term);
  return { row, panel, strip };
}

export type AttendanceDetail = NonNullable<Awaited<ReturnType<typeof loadAttendanceDetail>>>;

export async function loadSignupDetail(db: TxClient, ctx: ViewContext, signupId: string) {
  const row = await db.signup.findFirst({
    where: { id: signupId, organizationId: ctx.organizationId },
    select: {
      id: true,
      term: true,
      channel: true,
      classYear: true,
      signedUpAt: true,
      sourceUpdatedAt: true,
      submissions: true,
      addedToListAt: true,
      answers: true,
      suppressedAt: true,
      recordSource: true,
      status: true,
      firstAttendedAt: true,
      daysToFirstAttendance: true,
      contactId: true,
    },
  });
  if (!row) return null;
  const panel = await loadContactPanel(db, ctx.organizationId, row.contactId);
  if (!panel) return null;
  return { row, panel };
}

export type SignupDetail = NonNullable<Awaited<ReturnType<typeof loadSignupDetail>>>;

export async function loadPersonDetail(db: TxClient, ctx: ViewContext, rowId: string) {
  const sep = rowId.indexOf(":");
  if (sep <= 0) return null;
  const contactId = rowId.slice(0, sep);
  const term = rowId.slice(sep + 1);
  const stats = await db.contactTermStats.findFirst({
    where: { organizationId: ctx.organizationId, contactId, term },
    select: { term: true, sessionsAttended: true, stampCount: true, firstCheckInAt: true, lastCheckInAt: true },
  });
  if (!stats) return null;
  const panel = await loadContactPanel(db, ctx.organizationId, contactId);
  if (!panel) return null;
  const strip = await loadStampStrip(db, ctx.organizationId, contactId, term);
  return { id: peopleRowId(contactId, term), stats, panel, strip };
}

export type PersonDetail = NonNullable<Awaited<ReturnType<typeof loadPersonDetail>>>;

/**
 * The full labelled ballot, for viewers RLS lets see individual votes.
 * Opening it writes OrgAuditLog REVEAL_VOTES in the same transaction, so a
 * rolled-back read leaves no row and a committed one always does.
 */
export async function loadBallotDetail(db: TxClient, ctx: ViewContext, rowId: string, view: "choices" | "ballots") {
  const ballotId =
    view === "choices"
      ? (
          await db.ballotChoice.findFirst({
            where: { id: rowId, organizationId: ctx.organizationId },
            select: { ballotId: true },
          })
        )?.ballotId
      : rowId;
  if (!ballotId) return null;
  const ballot = await db.ballot.findFirst({
    where: { id: ballotId, organizationId: ctx.organizationId },
    select: {
      id: true,
      pollSlug: true,
      castAt: true,
      source: true,
      externalId: true,
      excludedReason: true,
      answers: true,
      ballotDefinition: { select: { id: true, title: true, slug: true, definition: true } },
      voter: { select: { id: true, displayName: true, emailMasked: true, userId: true, user: { select: userPublicSelect } } },
      choices: {
        orderBy: [{ questionKey: "asc" }, { rank: "asc" }],
        select: { id: true, questionKey: true, choiceKey: true, choiceText: true, isFreeText: true, rank: true },
      },
    },
  });
  if (!ballot) return null;
  const labels = definitionLabels(readDefinition(ballot.ballotDefinition?.definition));
  const questions = new Map<string, { key: string; label: string; answers: { label: string; rank: number | null; freeText: boolean }[] }>();
  for (const c of ballot.choices) {
    const q = questions.get(c.questionKey) ?? { key: c.questionKey, label: labels.question(c.questionKey), answers: [] };
    q.answers.push({
      label: c.isFreeText ? (c.choiceText ?? "") : labels.choice(c.questionKey, c.choiceKey),
      rank: c.rank,
      freeText: c.isFreeText,
    });
    questions.set(c.questionKey, q);
  }
  await writeOrgAuditLog(db, {
    organizationId: ctx.organizationId,
    action: "REVEAL_VOTES",
    targetType: "Ballot",
    targetId: ballot.id,
    diff: { pollSlug: ballot.pollSlug },
  });
  return { ballot, questions: [...questions.values()] };
}

export type BallotDetail = NonNullable<Awaited<ReturnType<typeof loadBallotDetail>>>;
