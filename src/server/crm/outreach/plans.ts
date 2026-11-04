import type { Prisma } from "@/generated/prisma/client";
import {
  audienceSet,
  campaignPlanStatus,
  previewOf,
  readExtras,
  sequencePlanStatus,
  withExtras,
  type Audience,
  type PlanExtras,
  type PlanStatus,
  type StepPreview,
} from "@/lib/crm/outreach/plans";
import type { TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "../access";
import type { RoleOwner } from "../owners";
import { parseListQuery, peopleWhere } from "../queries";
import { campaignsProgress } from "./campaigns";
import { viewParams } from "./lists";
import { contactable } from "./send";
import { assertMayEditPlan, enroll, setSequenceStatus } from "./sequences";

/**
 * Outreach plans (docs/features/crm.md, "Redesign", Outreach): sequences
 * and campaigns (a list split among members, or one email to everyone on
 * it) read as one list of plans, and what a plan's card needs: who it's for
 * and who's left out, what it got back, and starting it. A sequence's
 * audience, sender and daily cap live beside its send window (`plan`, see
 * src/lib/crm/outreach/plans.ts), so no new columns.
 */

export type PlanShape = "steps" | "email" | "split";

export interface PlanSummary {
  type: "sequence" | "campaign";
  id: string;
  name: string;
  shape: PlanShape;
  status: PlanStatus;
  /** Who it goes to, in words. */
  who: string;
  /** One line of where it stands. */
  note: string;
  preview: StepPreview[];
  updatedAt: string;
  /** Its one thing to do now, if any: start it, answer replies, work your share. */
  ambient: { key: "start" | "replies" | "share"; label: string; reason: string } | null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function shortDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Audience words for a list or a sequence's own filters: "Donor, gone quiet". */
export function audienceWords(
  a: Audience,
  relationships: ReadonlyMap<string, string>,
  members: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  if (a.relationship) parts.push(relationships.get(a.relationship) ?? "a relationship type");
  if (a.due === "cold") parts.push("gone quiet");
  if (a.due === "due") parts.push("due for a follow-up");
  if (a.due === "new") parts.push("added this week");
  if (a.owner === "me") parts.push("mine");
  else if (a.owner === "none") parts.push("with no owner");
  else if (a.owner) parts.push(`owned by ${members.get(a.owner) ?? "a member"}`);
  return parts.join(", ");
}

/** A list's stored filters as an audience. */
export function listAudience(filters: unknown): Audience {
  const p = viewParams(filters);
  return {
    relationship: p.rel ?? null,
    owner: p.owner ?? null,
    due: (p.due as Audience["due"]) ?? null,
    status: (p.status as Audience["status"]) ?? null,
  };
}

/** Everyone a plan's audience picks out, as a where (the viewer's RLS still applies). */
export function audienceWhere(
  organizationId: string,
  a: Audience,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Prisma.CrmPersonWhereInput {
  const sp: Record<string, string> = {};
  if (a.relationship) sp.rel = a.relationship;
  if (a.owner) sp.owner = a.owner;
  if (a.due) sp.due = a.due;
  if (a.status) sp.status = a.status;
  return peopleWhere(organizationId, parseListQuery(sp), viewerId, roles);
}

/** Every plan for the Outreach list: sequences and campaigns, newest first. */
export async function listPlans(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  names: { relationships: ReadonlyMap<string, string>; members: ReadonlyMap<string, string> },
): Promise<PlanSummary[]> {
  const out: PlanSummary[] = [];
  const sequences = await db.crmSequence.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      sendWindow: true,
      updatedAt: true,
      steps: {
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          delayDays: true,
          delayHours: true,
          subject: true,
          body: true,
          templateId: true,
          taskTitle: true,
        },
      },
    },
  });
  const counts = await db.crmEnrollment.groupBy({
    by: ["sequenceId", "status"],
    where: { organizationId, sequenceId: { in: sequences.map((s) => s.id) } },
    _count: { _all: true },
  });
  const waitingBy = await unansweredRepliesBySequence(
    db,
    organizationId,
    sequences.filter((s) => sequencePlanStatus(s.status) === "running").map((s) => s.id),
  );
  const n = (id: string, statuses: string[]) =>
    counts
      .filter((c) => c.sequenceId === id && statuses.includes(c.status))
      .reduce((a, c) => a + c._count._all, 0);
  for (const s of sequences) {
    const extras = readExtras(s.sendWindow);
    const status = sequencePlanStatus(s.status);
    const inIt = n(s.id, [
      "ACTIVE",
      "PAUSED",
      "REPLIED",
      "BOOKED",
      "FINISHED",
      "STOPPED",
      "BOUNCED",
      "UNSUBSCRIBED",
    ]);
    const replied = n(s.id, ["REPLIED", "BOOKED"]);
    const booked = n(s.id, ["BOOKED"]);
    const who = audienceWords(extras.who, names.relationships, names.members);
    const sender =
      extras.from === "owner" ? "Sent by each person's owner." : "Sent by whoever adds them.";
    const note =
      inIt === 0
        ? sender
        : `${sender} ${plural(inIt, "person", "people")} in it, ${replied} replied${booked ? `, ${booked} booked` : ""}.`;
    let ambient: PlanSummary["ambient"] = null;
    if (status === "draft" && s.steps.length > 0 && audienceSet(extras.who)) {
      ambient = { key: "start", label: "Start it", reason: "Steps and who are set" };
    } else if (status === "running") {
      const waiting = waitingBy.get(s.id) ?? 0;
      if (waiting > 0) {
        ambient = {
          key: "replies",
          label: `See the ${waiting === 1 ? "reply" : `${waiting} replies`}`,
          reason: `${plural(waiting, "reply", "replies")} nobody has answered`,
        };
      }
    }
    out.push({
      type: "sequence",
      id: s.id,
      name: s.name,
      shape: "steps",
      status,
      who: who ? `People who are ${who}` : inIt ? "People added by hand" : "Nobody picked yet",
      note,
      preview: previewOf(s.steps),
      updatedAt: s.updatedAt.toISOString(),
      ambient,
    });
  }

  const campaigns = await db.crmCampaign.findMany({
    where: { organizationId, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      name: true,
      status: true,
      channel: true,
      viewId: true,
      sequenceId: true,
      templateId: true,
      eventId: true,
      dueOn: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const views = await db.crmView.findMany({
    where: {
      organizationId,
      id: { in: campaigns.map((c) => c.viewId).filter((v): v is string => Boolean(v)) },
    },
    select: { id: true, name: true },
  });
  // What the list shows of each, read for all of them at once: a group
  // email's mail, a split list's progress, its steps and the viewer's share.
  const bulkIds = campaigns.filter((c) => c.channel === "bulk").map((c) => c.id);
  const splits = campaigns.filter((c) => c.channel !== "bulk");
  const mail = bulkIds.length
    ? await db.crmEmailMessage.groupBy({
        by: ["campaignId", "status"],
        where: { organizationId, campaignId: { in: bulkIds } },
        _count: { _all: true, repliedAt: true, bouncedAt: true },
      })
    : [];
  const firstSubject = new Map(
    (bulkIds.length
      ? await db.$queryRaw<{ campaignId: string; subject: string | null }[]>`
          SELECT DISTINCT ON ("campaignId") "campaignId", subject
          FROM "CrmEmailMessage"
          WHERE "organizationId" = ${organizationId} AND "campaignId" = ANY(${bulkIds}::text[])
          ORDER BY "campaignId", "createdAt" ASC`
      : []
    ).map((r) => [r.campaignId, r.subject]),
  );
  const progress = await campaignsProgress(db, organizationId, splits);
  const seqIds = [...new Set(splits.map((c) => c.sequenceId).filter((x): x is string => Boolean(x)))];
  const stepsOf = new Map(
    (seqIds.length
      ? await db.crmSequence.findMany({
          where: { organizationId, id: { in: seqIds } },
          select: {
            id: true,
            steps: {
              orderBy: { sortOrder: "asc" },
              select: {
                kind: true,
                delayDays: true,
                delayHours: true,
                subject: true,
                body: true,
                templateId: true,
                taskTitle: true,
              },
            },
          },
        })
      : []
    ).map((s) => [s.id, s.steps]),
  );
  const mineBy = new Map(
    (splits.length
      ? await db.crmCampaignTarget.groupBy({
          by: ["campaignId"],
          where: {
            organizationId,
            campaignId: { in: splits.map((c) => c.id) },
            assigneeId: viewerId,
            status: "TODO",
          },
          _count: { _all: true },
        })
      : []
    ).map((r) => [r.campaignId, r._count._all]),
  );
  for (const c of campaigns) {
    const bulk = c.channel === "bulk";
    const list = views.find((v) => v.id === c.viewId)?.name ?? null;
    let note: string;
    let preview: StepPreview[];
    let ambient: PlanSummary["ambient"] = null;
    let total: number;
    if (bulk) {
      const theirs = mail.filter((m) => m.campaignId === c.id);
      const sent = theirs.filter((m) => m.status === "SENT").reduce((a, m) => a + m._count._all, 0);
      const replied = theirs.reduce((a, m) => a + m._count.repliedAt, 0);
      const bounced = theirs.reduce((a, m) => a + m._count.bouncedAt, 0);
      const first = { subject: firstSubject.get(c.id) ?? null };
      total = theirs.reduce((a, m) => a + m._count._all, 0);
      note = `Sent ${shortDay(c.createdAt)} from the organization. ${sent} sent, ${replied} replied${bounced ? `, ${bounced} bounced` : ""}.`;
      preview = [
        {
          what: first?.subject?.slice(0, 34) || "One email",
          when: shortDay(c.createdAt),
          kind: "email",
        },
      ];
    } else {
      const p = progress.get(c.id)!;
      total = p.total;
      const splitAmong = p.byMember.filter((m) => m.userId).length;
      note = `${splitAmong > 1 ? `Split among ${splitAmong} members. ` : ""}${p.contacted} of ${p.total} reached, ${p.replied} replied${p.booked ? `, ${p.booked} booked` : ""}.`;
      if (c.sequenceId) {
        preview = previewOf(stepsOf.get(c.sequenceId) ?? []);
      } else {
        const what =
          c.channel === "call"
            ? "Call"
            : c.channel === "event"
              ? "Event invite"
              : c.channel.startsWith("form:")
                ? "Form link"
                : "Email";
        preview = [{ what, when: "Day 0", kind: c.channel === "call" ? "call" : "email" }];
      }
      const mine = mineBy.get(c.id) ?? 0;
      if (c.status === "ACTIVE" && mine > 0) {
        ambient = {
          key: "share",
          label: `Do my ${mine}`,
          reason: c.dueOn
            ? `${plural(mine, "person", "people")} of yours, by ${shortDay(c.dueOn)}`
            : `${plural(mine, "person", "people")} of yours not reached yet`,
        };
      }
    }
    out.push({
      type: "campaign",
      id: c.id,
      name: c.name,
      shape: bulk ? "email" : "split",
      status: campaignPlanStatus(c.status),
      who: list
        ? `${list}, ${plural(total, "person", "people")}`
        : plural(total, "person", "people"),
      note,
      preview,
      updatedAt: c.updatedAt.toISOString(),
      ambient,
    });
  }
  return out;
}

/** People in a sequence who wrote back and nobody has answered since. */
export async function unansweredReplies(
  db: TxClient,
  organizationId: string,
  sequenceId: string,
): Promise<number> {
  return (await unansweredRepliesBySequence(db, organizationId, [sequenceId])).get(sequenceId) ?? 0;
}

/**
 * unansweredReplies for many sequences in three reads: who replied, each
 * one's latest mail in, and the latest mail out on those threads.
 */
export async function unansweredRepliesBySequence(
  db: TxClient,
  organizationId: string,
  sequenceIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sequenceIds.length === 0) return out;
  const replied = await db.crmEnrollment.findMany({
    where: { organizationId, sequenceId: { in: [...sequenceIds] }, status: { in: ["REPLIED", "BOOKED"] } },
    select: { sequenceId: true, personId: true },
    take: 200 * sequenceIds.length,
  });
  const personIds = [...new Set(replied.map((r) => r.personId))];
  if (personIds.length === 0) return out;
  const latestIn = new Map(
    (
      await db.$queryRaw<{ personId: string; threadId: string; createdAt: Date }[]>`
        SELECT DISTINCT ON ("personId") "personId", "threadId", "createdAt"
        FROM "CrmEmailMessage"
        WHERE "organizationId" = ${organizationId} AND direction = 'INBOUND'
          AND "personId" = ANY(${personIds}::text[])
        ORDER BY "personId", "createdAt" DESC`
    ).map((m) => [m.personId, m]),
  );
  const threadIds = [...new Set([...latestIn.values()].map((m) => m.threadId))];
  const lastOut = new Map(
    (threadIds.length
      ? await db.crmEmailMessage.groupBy({
          by: ["threadId"],
          where: { organizationId, threadId: { in: threadIds }, direction: "OUTBOUND" },
          _max: { createdAt: true },
        })
      : []
    ).map((o) => [o.threadId, o._max.createdAt]),
  );
  for (const r of replied) {
    const inbound = latestIn.get(r.personId);
    if (!inbound) continue;
    const answered = lastOut.get(inbound.threadId);
    if (answered && answered > inbound.createdAt) continue;
    out.set(r.sequenceId, (out.get(r.sequenceId) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------- who's in a sequence plan

export interface AudienceRow {
  personId: string;
  name: string;
  /** Why they're left out, in words; null when they're in. */
  why: string | null;
  /** Another plan has them: "Include anyway" lets them in. */
  canInclude: boolean;
  /** Already in this plan. */
  inIt: boolean;
}

/** Who a sequence's audience picks out today, each with whether they're left out and why. */
export async function audienceRows(
  db: TxClient,
  organizationId: string,
  sequenceId: string,
  extras: PlanExtras,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  max = 2000,
): Promise<AudienceRow[]> {
  if (!audienceSet(extras.who)) return [];
  const people = await db.crmPerson.findMany({
    where: audienceWhere(organizationId, extras.who, viewerId, roles),
    orderBy: [{ strength: "desc" }, { name: "asc" }],
    take: max,
    select: {
      id: true,
      name: true,
      primaryEmail: true,
      doNotContact: true,
      unsubscribedAt: true,
      consent: true,
      deletedAt: true,
    },
  });
  const ids = people.map((p) => p.id);
  const active = await db.crmEnrollment.findMany({
    where: { organizationId, personId: { in: ids }, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { personId: true, sequenceId: true, sequence: { select: { name: true } } },
  });
  const included = new Set(extras.include);
  return people.map((p) => {
    const can = contactable(p);
    const mine = active.find((a) => a.personId === p.id && a.sequenceId === sequenceId);
    const other = active.find((a) => a.personId === p.id && a.sequenceId !== sequenceId);
    if (!can.ok)
      return {
        personId: p.id,
        name: p.name,
        why: can.reason,
        canInclude: false,
        inIt: Boolean(mine),
      };
    if (!mine && other && !included.has(p.id)) {
      return {
        personId: p.id,
        name: p.name,
        why: `Already in "${other.sequence.name}"`,
        canInclude: true,
        inIt: false,
      };
    }
    return { personId: p.id, name: p.name, why: null, canInclude: false, inIt: Boolean(mine) };
  });
}

/** A sequence plan's own settings (who, sender, cap, who's let in anyway), merged into its send window. */
export async function savePlanExtras(
  actor: CrmActor,
  sequenceId: string,
  patch: Partial<PlanExtras>,
): Promise<PlanExtras> {
  const { db, organizationId } = actor;
  const seq = await db.crmSequence.findFirst({
    where: { id: sequenceId, organizationId, archivedAt: null },
    select: { id: true, sendWindow: true, status: true, createdById: true },
  });
  if (!seq) throw new CrmError("That plan isn't here any more.");
  await assertMayEditPlan(actor, seq);
  const now = readExtras(seq.sendWindow);
  const next = readExtras(
    withExtras(seq.sendWindow, {
      ...now,
      ...patch,
      who: patch.who ?? now.who,
      include: patch.include ?? now.include,
    }),
  );
  await db.crmSequence.update({
    where: { id: seq.id },
    data: { sendWindow: withExtras(seq.sendWindow, next) as Prisma.InputJsonObject },
  });
  return next;
}

/**
 * Starts a sequence plan: switches it on and puts in everyone its audience
 * picks out who isn't left out, each sent from their owner (when the plan
 * says so and the owner is a member) or the member starting it. Each first
 * email is written now, as previewed. Start approves it when it goes as
 * the one pressing Start, or they made the plan or manage the CRM; any
 * other owner's first email is a draft for that owner (enroll,
 * startMayApprove).
 */
export async function startPlan(
  actor: CrmActor,
  sequenceId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<{ enrolled: number; skipped: number }> {
  const { db, organizationId, userId } = actor;
  await setSequenceStatus(actor, sequenceId, "ON");
  const seq = await db.crmSequence.findFirst({
    where: { id: sequenceId, organizationId },
    select: { sendWindow: true },
  });
  const extras = readExtras(seq?.sendWindow);
  const rows = await audienceRows(db, organizationId, sequenceId, extras, userId, roles);
  const go = rows.filter((r) => !r.why && !r.inIt).map((r) => r.personId);
  if (go.length === 0) return { enrolled: 0, skipped: 0 };
  const bySender = new Map<string, string[]>();
  if (extras.from === "owner") {
    const owners = await db.crmPerson.findMany({
      where: { organizationId, id: { in: go } },
      select: { id: true, ownerId: true },
    });
    const memberIds = new Set(
      (
        await db.membership.findMany({
          where: {
            organizationId,
            userId: { in: owners.map((o) => o.ownerId).filter((o): o is string => Boolean(o)) },
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    for (const o of owners) {
      const sender = o.ownerId && memberIds.has(o.ownerId) ? o.ownerId : userId;
      bySender.set(sender, [...(bySender.get(sender) ?? []), o.id]);
    }
  } else {
    bySender.set(userId, go);
  }
  let enrolled = 0;
  let skipped = 0;
  for (const [senderId, ids] of bySender) {
    for (let i = 0; i < ids.length; i += 500) {
      const r = await enroll(actor, sequenceId, ids.slice(i, i + 500), { senderId });
      enrolled += r.enrolled;
      skipped += r.skipped.length;
    }
  }
  return { enrolled, skipped };
}
