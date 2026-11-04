import { KIND_LABELS } from "@/lib/crm/suggestions";
import type { TxClient } from "@/server/db/context";

import { pendingDuplicates } from "./dedupe";
import { openCallSteps } from "./phone/queue";
import { followUpQueue, type QueueItem, type QueueReason } from "./outreach/queue";
import type { RoleOwner } from "./owners";
import { todayList } from "./queries";
import { listQueue } from "./review";

/**
 * Today, rebuilt (docs/features/crm.md, "Redesign"): one list of who needs
 * you and why, in four groups (Replies, Due today, To approve, Calls), each
 * row with what happened and at most two ambient buttons that do the job,
 * each with its reason. Built from what the CRM already keeps: the
 * follow-up queue (replies, steps, follow-ups, new people, campaigns,
 * cadences, going cold), stuck deals and deals with no next step, the
 * review queue, duplicates and the viewer's call steps. The buttons are
 * descriptors here; the client turns each into the action it names.
 */

export type TodayGroup = "replies" | "due" | "approve" | "calls";

export const TODAY_GROUPS: readonly { id: TodayGroup; label: string }[] = [
  { id: "replies", label: "Replies" },
  { id: "due", label: "Due today" },
  { id: "approve", label: "To approve" },
  { id: "calls", label: "Calls" },
];

export type TodayAction =
  | { type: "open"; label: string; open: string; tone: "solid" | "outline" | "spark" }
  | {
      type: "send-draft";
      label: string;
      draftId: string;
      personId: string;
      subject: string;
      body: string;
      replyTo: string | null;
    }
  | { type: "snooze"; id: string }
  | { type: "push"; personId: string }
  | { type: "step-done"; stepId: string }
  | { type: "call"; label: string; phone: string }
  | { type: "accept"; suggestionId: string; label: string }
  | { type: "reject"; suggestionId: string; label: string }
  | { type: "merge"; suggestionId: string; keepId: string }
  | { type: "not-dupe"; suggestionId: string };

export interface TodayRow {
  key: string;
  group: TodayGroup;
  /** The card its name opens (?open=), when it has one. */
  open: string | null;
  name: string;
  tag: string | null;
  /** What happened, in a sentence. */
  text: string;
  draft: string | null;
  change: { before: string | null; after: string } | null;
  /** Someone else is already talking to them. */
  warn: string | null;
  /** The reason, beside the buttons. */
  why: string;
  actions: TodayAction[];
  /** Power hour can work it (a person with an email or a number). */
  person: {
    id: string;
    email: boolean;
    phone: string | null;
    reply: { messageId: string; subject: string } | null;
  } | null;
}

const DAY = 86_400_000;

/** A suggestion's payload as an object (a row with none, or a broken one, reads as empty). */
export function payloadOf(raw: unknown): { draftId?: unknown; subject?: unknown; body?: unknown } {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function ago(at: Date | null, now: Date): string {
  if (!at) return "";
  const mins = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function quietFor(at: Date | null, now: Date): string {
  if (!at) return "Never in touch";
  return `${Math.floor((now.getTime() - at.getTime()) / DAY)} days quiet`;
}

function reasonText(item: QueueItem, r: QueueReason): string {
  switch (r.kind) {
    case "reply":
      return r.label.startsWith("Replied: ") ? `Replied to "${r.label.slice(9)}".` : "Replied.";
    case "step":
      return `${r.label}.`;
    case "followup":
      return r.label === "Follow-up overdue"
        ? "Their follow-up is overdue."
        : "Their follow-up is today.";
    case "new":
      return `${r.label}. Nobody has been in touch yet.`;
    case "campaign":
      return `In your share of ${r.label}, not reached yet.`;
    case "cadence":
      return `${r.label}.`;
    case "cold":
      return `Nobody has been in touch since ${item.lastContactedAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) ?? "a while"}.`;
  }
}

/** The people waiting drafts are for, who can still be emailed (Send works; Power hour can work them). */
async function draftRecipients(
  db: TxClient,
  organizationId: string,
  suggestions: readonly { kind: string; target: { kind: string; id: string } | null }[],
): Promise<Map<string, { id: string; phone: string | null }>> {
  const ids = [
    ...new Set(
      suggestions
        .filter((s) => s.kind === "DRAFT_EMAIL" && s.target?.kind === "person")
        .map((s) => s.target!.id),
    ),
  ];
  if (ids.length === 0) return new Map();
  const people = await db.crmPerson.findMany({
    where: {
      organizationId,
      id: { in: ids },
      deletedAt: null,
      doNotContact: false,
      unsubscribedAt: null,
      primaryEmail: { not: null },
    },
    select: { id: true, phone: true },
  });
  return new Map(people.map((p) => [p.id, p]));
}

export interface TodayData {
  rows: TodayRow[];
  /** Showing the viewer's own (false: everyone's, asked for or because nothing is theirs). */
  mine: boolean;
}

export async function todayRows(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  options: {
    everyone: boolean;
    relationships: ReadonlyMap<string, string>;
    now?: Date;
    /** A Personal space: no shares of a list split among members. */
    personal?: boolean;
  },
): Promise<TodayData> {
  const now = options.now ?? new Date();
  let items = await followUpQueue(db, organizationId, viewerId, roles, {
    mine: !options.everyone,
    now,
  });
  let mine = !options.everyone;
  if (mine && items.length === 0) {
    items = await followUpQueue(db, organizationId, viewerId, roles, {
      mine: false,
      limit: 40,
      now,
    });
    mine = false;
  }
  const personIds = items.filter((i) => i.targetKind === "person").map((i) => i.id);
  const relationship = new Map(
    items.map((p) => [
      p.id,
      p.relationship ? (options.relationships.get(p.relationship) ?? null) : null,
    ]),
  );
  // The viewer's unsent drafts (the follow-up agent's, an automation's held for review).
  const drafts = personIds.length
    ? await db.crmEmailMessage.findMany({
        where: {
          organizationId,
          status: "DRAFT",
          mailboxUserId: viewerId,
          personId: { in: personIds },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, personId: true, subject: true, bodyText: true },
      })
    : [];
  // The viewer's waiting drafts and changes (To approve). A draft that has a
  // To approve row is sent from there, not offered again on the person's row.
  const suggestions = await listQueue(db, organizationId, viewerId, { mine: true, take: 25 });
  const approving = new Set(
    suggestions
      .map((s) => (s.kind === "DRAFT_EMAIL" ? payloadOf(s.payload).draftId : null))
      .filter((x): x is string => typeof x === "string"),
  );
  const draftFor = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) {
    if (d.personId && !approving.has(d.id) && !draftFor.has(d.personId)) draftFor.set(d.personId, d);
  }
  const callSteps = await openCallSteps(db, organizationId, viewerId);

  const rows: TodayRow[] = [];
  for (const item of items) {
    if (options.personal && item.reasons.every((r) => r.kind === "campaign")) continue;
    const first = item.reasons[0]!;
    const reply = item.reasons.find((r) => r.kind === "reply");
    const step = item.reasons.find((r) => r.kind === "step");
    const isPerson = item.targetKind === "person";
    const open = `${item.targetKind}:${item.id}`;
    const draft = isPerson ? draftFor.get(item.id) : undefined;
    const blocked = item.doNotContact || item.unsubscribed;
    const person =
      isPerson && !blocked
        ? {
            id: item.id,
            email: Boolean(item.email),
            phone: item.phone,
            reply: reply?.ref
              ? { messageId: reply.ref, subject: reply.label.replace(/^Replied: /, "") }
              : null,
          }
        : null;
    const base = {
      key: item.key,
      open,
      name: item.name,
      tag: isPerson ? (relationship.get(item.id) ?? null) : "Company",
      draft: draft ? (draft.bodyText ?? "").trim() || null : null,
      change: null,
      warn: null,
      person,
    };
    const snooze: TodayAction = { type: "snooze", id: item.id };
    const sendDraft = (label: string, replyTo: string | null): TodayAction | null =>
      draft && item.email && !blocked
        ? {
            type: "send-draft",
            label,
            draftId: draft.id,
            personId: item.id,
            subject: draft.subject ?? "",
            body: draft.bodyText ?? "",
            replyTo,
          }
        : null;

    if (reply) {
      const send = sendDraft("Send reply", reply.ref ?? null);
      rows.push({
        ...base,
        group: "replies",
        text: reasonText(item, reply),
        why: `Replied ${ago(reply.at, now)}${draft ? ", draft ready" : ""}`,
        actions: [send ?? { type: "open", label: "Reply", open, tone: "solid" }, snooze],
      });
      continue;
    }
    const callStep = isPerson ? callSteps.get(item.id) : undefined;
    if (callStep && item.phone && !item.doNotContact) {
      rows.push({
        ...base,
        group: "calls",
        text: step ? reasonText(item, step) : "A sequence asked you to call.",
        why:
          step?.at && step.at.getTime() < now.getTime() - DAY
            ? "Promised, and it's late"
            : "Promised for today",
        actions: [
          { type: "call", label: `Call ${item.name.split(" ")[0]}`, phone: item.phone },
          { type: "step-done", stepId: callStep },
        ],
      });
      continue;
    }
    const actions: TodayAction[] = [];
    let why = first.label;
    if (first.kind === "step" && step?.ref) {
      actions.push({ type: "step-done", stepId: step.ref }, snooze);
      why = "A step a sequence left you";
    } else if (first.kind === "followup") {
      actions.push(
        sendDraft("Send", null) ?? { type: "open", label: "Follow up", open, tone: "solid" },
      );
      actions.push(isPerson ? { type: "push", personId: item.id } : snooze);
      why = first.label === "Follow-up overdue" ? `Due ${ago(first.at, now)}` : "Due today";
    } else if (first.kind === "cold" || first.kind === "cadence") {
      actions.push(
        sendDraft("Send", null) ?? { type: "open", label: "Check in", open, tone: "spark" },
        snooze,
      );
      why = quietFor(item.lastContactedAt, now);
    } else if (first.kind === "new") {
      actions.push(
        sendDraft("Send", null) ?? { type: "open", label: "Say hello", open, tone: "solid" },
        snooze,
      );
      why = `New ${ago(first.at, now)}`;
    } else {
      actions.push(
        sendDraft("Send", null) ?? { type: "open", label: "Reach out", open, tone: "solid" },
        snooze,
      );
    }
    rows.push({ ...base, group: "due", text: reasonText(item, first), why, actions });
  }

  // Deals that are stuck or have no next step.
  const deals = await todayList(db, organizationId, viewerId, roles, { mine }, now);
  const seen = new Set<string>();
  for (const d of [...deals.stuck, ...deals.nostep]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const open = `deal:${d.id}`;
    rows.push({
      key: `deal:${d.id}`,
      group: "due",
      open,
      name: d.title,
      tag: "Deal",
      text: d.kind === "stuck" ? `${d.sub}.` : `${d.sub}, with no next step.`,
      draft: null,
      change: null,
      warn: null,
      why: d.kind === "stuck" ? "Past its stage's limit" : "No next step",
      actions: [
        d.kind === "stuck"
          ? { type: "open", label: "Move it on", open, tone: "solid" }
          : { type: "open", label: "Add a next step", open, tone: "spark" },
      ],
      person: null,
    });
  }

  // To approve: drafts that wait for a person to send them (automations,
  // a plan's later steps, the follow-up agent), AI and automation changes,
  // people found in mail, duplicates.
  const draftPeople = await draftRecipients(db, organizationId, suggestions);
  for (const s of suggestions) {
    const row = s.rows[0];
    const payload = payloadOf(s.payload);
    const recipient = s.kind === "DRAFT_EMAIL" && s.target?.kind === "person" ? draftPeople.get(s.target.id) : undefined;
    if (recipient && typeof payload.draftId === "string") {
      // Send is the person's OK: it goes through compose with this draft (ten seconds to Undo).
      rows.push({
        key: `suggestion:${s.id}`,
        group: "approve",
        open: `person:${recipient.id}`,
        name: s.target!.name,
        tag: KIND_LABELS[s.kind],
        text: s.title,
        draft: typeof payload.body === "string" ? payload.body.trim() || null : null,
        change: null,
        warn: null,
        why: s.citation?.label ? `From ${s.citation.label}` : `Drafted ${ago(s.createdAt, now)}`,
        actions: [
          {
            type: "send-draft",
            label: "Send",
            draftId: payload.draftId,
            personId: recipient.id,
            subject: typeof payload.subject === "string" ? payload.subject : "",
            body: typeof payload.body === "string" ? payload.body : "",
            replyTo: null,
          },
          { type: "reject", suggestionId: s.id, label: "Don't send" },
        ],
        person: { id: recipient.id, email: true, phone: recipient.phone, reply: null },
      });
      continue;
    }
    rows.push({
      key: `suggestion:${s.id}`,
      group: "approve",
      open: s.target ? `${s.target.kind}:${s.target.id}` : null,
      name: s.target?.name ?? s.title,
      tag: KIND_LABELS[s.kind],
      text: s.target ? s.title : (s.summary ?? s.title),
      draft:
        s.kind === "DRAFT_EMAIL"
          ? (typeof payloadOf(s.payload).body === "string" ? String(payloadOf(s.payload).body).trim() : "") || null
          : null,
      change: s.kind === "UPDATE_FIELD" && row ? { before: row.before, after: row.after } : null,
      warn: null,
      why: s.citation?.label ? `From ${s.citation.label}` : `Suggested ${ago(s.createdAt, now)}`,
      actions: [
        {
          type: "accept",
          suggestionId: s.id,
          // A draft that can't be sent from here (no address, asked not to be
          // contacted) stays in compose: accepting never sends anything.
          label:
            s.kind === "DRAFT_EMAIL" ? "Keep the draft" : s.kind === "CREATE_PERSON" ? "Add them" : "Accept",
        },
        {
          type: "reject",
          suggestionId: s.id,
          label: s.kind === "CREATE_PERSON" ? "Not a contact" : "Reject",
        },
      ],
      person: null,
    });
  }
  const dupes = await pendingDuplicates(db, organizationId, 15);
  for (const d of dupes) {
    const [a, b] = d.records;
    rows.push({
      key: `dupe:${d.id}`,
      group: "approve",
      open: `${d.object}:${a!.id}`,
      name: `${a!.name} and ${b!.name}`,
      tag: "Possible duplicate",
      text: "Merging keeps both timelines, addresses and deals.",
      draft: null,
      change: null,
      warn: null,
      why: d.reasons[0] ?? "They look alike",
      actions: [
        { type: "merge", suggestionId: d.id, keepId: a!.id },
        { type: "not-dupe", suggestionId: d.id },
      ],
      person: null,
    });
  }
  return { rows, mine };
}

/** Upcoming meetings with people in the CRM (the right column's Coming up). */
export async function comingUp(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  options: { everyone: boolean; now?: Date; take?: number },
): Promise<
  {
    id: string;
    personId: string | null;
    personName: string | null;
    subject: string;
    at: Date;
    lines: string[];
  }[]
> {
  const now = options.now ?? new Date();
  const meetings = await db.crmActivity.findMany({
    where: {
      organizationId,
      kind: "MEETING",
      deletedAt: null,
      occurredAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY) },
      ...(options.everyone ? {} : { actorId: viewerId }),
    },
    orderBy: { occurredAt: "asc" },
    take: options.take ?? 3,
    select: {
      id: true,
      subject: true,
      body: true,
      occurredAt: true,
      targets: { where: { targetKind: "person" }, select: { targetId: true }, take: 1 },
    },
  });
  const ids = meetings.map((m) => m.targets[0]?.targetId).filter((x): x is string => Boolean(x));
  const people = ids.length
    ? await db.crmPerson.findMany({
        where: { organizationId, id: { in: ids } },
        select: {
          id: true,
          name: true,
          lastContactedAt: true,
          company: { select: { name: true } },
        },
      })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return meetings.map((m) => {
    const pid = m.targets[0]?.targetId ?? null;
    const p = pid ? byId.get(pid) : undefined;
    const lines = [
      p?.company?.name ?? null,
      p?.lastContactedAt
        ? `Last in touch ${p.lastContactedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : null,
    ].filter((x): x is string => Boolean(x));
    return {
      id: m.id,
      personId: p ? p.id : null,
      personName: p?.name ?? null,
      subject: m.subject ?? "A meeting",
      at: m.occurredAt,
      lines,
    };
  });
}
