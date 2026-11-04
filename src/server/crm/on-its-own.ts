import { localDateKey, addDaysToKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import { changeLabel } from "./review";

/**
 * "Done on its own" (docs/features/crm.md, "Redesign"): what the CRM did
 * without anyone clicking, read from where it's already recorded:
 *
 * - sent: email an automation or a sequence sent or is about to send
 *   (CrmEmailMessage with a workflow or an enrollment). One still waiting
 *   can be cancelled; one that went can't be taken back, so it has no Undo.
 * - changed: fields an automation or the system changed (CrmFieldHistory,
 *   source "automation" or "system"), undone by putting the record back to
 *   just before, while nothing has changed it since; and the other steps an
 *   automation ran (its run log: tasks, deals, notifications, posts), which
 *   have no undo here.
 * - held: email an automation drafted for review instead of sending (Send
 *   anyway sends the draft), mail the send job held back (do not contact,
 *   unsubscribed, bounced) and steps an automation skipped, with why.
 *
 * Read as the member (RLS), the last `days` days.
 */

export type OnItsOwnKind = "sent" | "changed" | "held";

export type OnItsOwnUndo =
  | { type: "cancel-email"; messageId: string }
  | { type: "restore"; kind: "person" | "company" | "deal"; id: string; before: string };

export interface OnItsOwnSend {
  personId: string;
  subject: string;
  body: string;
  draftId: string;
}

export interface OnItsOwnEntry {
  id: string;
  kind: OnItsOwnKind;
  at: Date;
  text: string;
  why: string;
  undo: OnItsOwnUndo | null;
  send: OnItsOwnSend | null;
}

const NOT_HELD = new Set(["cancelled", "discarded", "untracked"]);
const RUN_STEPS = new Set([
  "task.create",
  "deal.create",
  "event.invite",
  "notify",
  "slack.post",
  "discord.post",
  "webhook.call",
  "finance.create",
  "project.start",
  "sequence.enroll",
]);
// Run steps whose effects are already listed from history or mail.
const LISTED_ELSEWHERE = new Set(["field.set", "stage.move", "template.send", "owner.assign"]);

/** Fields history keeps under their storage names, in words. */
const FIELD_WORDS: Record<string, string> = {
  ownerId: "owner",
  ownerRoleKey: "owner",
  stageId: "stage",
  companyId: "company",
  primaryPersonId: "person",
  reason: "why",
  closeReason: "why it closed",
};

function fieldWords(kind: "person" | "company" | "deal", field: string): string {
  return FIELD_WORDS[field] ?? changeLabel(kind, field).toLowerCase();
}

function quote(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  return t ? `"${t.length > 70 ? `${t.slice(0, 67)}...` : t}"` : "an email";
}

function list(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export async function onItsOwn(
  db: TxClient,
  organizationId: string,
  options: { days?: number; now?: Date; tz?: string } = {},
): Promise<OnItsOwnEntry[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.days ?? 7) * 86_400_000);
  const out: OnItsOwnEntry[] = [];

  // ---- Mail an automation or a sequence sent (or holds) ----
  const mail = await db.crmEmailMessage.findMany({
    where: {
      organizationId,
      direction: "OUTBOUND",
      createdAt: { gte: since },
      status: { in: ["SENT", "QUEUED", "FAILED"] },
      OR: [{ workflowId: { not: null } }, { enrollmentId: { not: null } }],
      // A draft a person approved and sent is theirs, not done on its own.
      createdById: null,
    },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: {
      id: true,
      status: true,
      subject: true,
      personId: true,
      workflowId: true,
      enrollmentId: true,
      error: true,
      sentAt: true,
      scheduledFor: true,
      createdAt: true,
    },
  });
  const people = new Map<string, string>();
  const personIds = new Set(mail.map((m) => m.personId).filter((x): x is string => Boolean(x)));

  const drafts = await db.crmSuggestion.findMany({
    where: {
      organizationId,
      kind: "DRAFT_EMAIL",
      source: "AUTOMATION",
      status: "PENDING",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, targetId: true, payload: true, citation: true, createdAt: true },
  });
  for (const d of drafts) if (d.targetId) personIds.add(d.targetId);

  const workflowIds = new Set(mail.map((m) => m.workflowId).filter((x): x is string => Boolean(x)));
  const enrollmentIds = [
    ...new Set(mail.map((m) => m.enrollmentId).filter((x): x is string => Boolean(x))),
  ];

  // ---- Fields an automation or the system changed ----
  const changes = await db.crmFieldHistory.findMany({
    where: { organizationId, source: { in: ["automation", "system"] }, changedAt: { gte: since } },
    orderBy: { changedAt: "desc" },
    take: 300,
    select: {
      targetKind: true,
      targetId: true,
      field: true,
      newValue: true,
      source: true,
      changedAt: true,
    },
  });
  const groups = new Map<
    string,
    {
      kind: string;
      id: string;
      source: string;
      first: Date;
      last: Date;
      fields: { field: string; value: unknown }[];
    }
  >();
  for (const c of changes) {
    const key = `${c.targetKind}:${c.targetId}:${c.source}:${Math.floor(c.changedAt.getTime() / 5000)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        kind: c.targetKind,
        id: c.targetId,
        source: c.source,
        first: c.changedAt,
        last: c.changedAt,
        fields: [],
      };
      groups.set(key, g);
    }
    if (c.changedAt < g.first) g.first = c.changedAt;
    if (c.changedAt > g.last) g.last = c.changedAt;
    if (!g.fields.some((f) => f.field === c.field))
      g.fields.push({ field: c.field, value: c.newValue });
  }
  const changeGroups = [...groups.values()].slice(0, 60);
  for (const g of changeGroups) if (g.kind === "person") personIds.add(g.id);

  // ---- Automation runs: their other steps, and which automation changed what ----
  const runs = await db.crmWorkflowRun.findMany({
    where: { organizationId, dryRun: false, startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 150,
    select: {
      id: true,
      workflowId: true,
      triggerRef: true,
      log: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  for (const r of runs) workflowIds.add(r.workflowId);

  // Names, as the member sees them.
  if (personIds.size) {
    for (const p of await db.crmPerson.findMany({
      where: { organizationId, id: { in: [...personIds] } },
      select: { id: true, name: true },
    })) {
      people.set(p.id, p.name);
    }
  }
  const companyIds = changeGroups.filter((g) => g.kind === "company").map((g) => g.id);
  const dealIds = changeGroups.filter((g) => g.kind === "deal").map((g) => g.id);
  const companies = new Map(
    companyIds.length
      ? (
          await db.crmCompany.findMany({
            where: { organizationId, id: { in: companyIds } },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, c.name])
      : [],
  );
  const deals = new Map(
    dealIds.length
      ? (
          await db.crmDeal.findMany({
            where: { organizationId, id: { in: dealIds } },
            select: { id: true, title: true },
          })
        ).map((d) => [d.id, d.title])
      : [],
  );
  const workflows = new Map(
    workflowIds.size
      ? (
          await db.crmWorkflow.findMany({
            where: { organizationId, id: { in: [...workflowIds] } },
            select: { id: true, name: true },
          })
        ).map((w) => [w.id, w.name])
      : [],
  );
  const sequences = new Map(
    enrollmentIds.length
      ? (
          await db.crmEnrollment.findMany({
            where: { organizationId, id: { in: enrollmentIds } },
            select: { id: true, sequence: { select: { name: true } } },
          })
        ).map((e) => [e.id, e.sequence.name])
      : [],
  );
  const stageIds = changeGroups.flatMap((g) =>
    g.fields
      .filter((f) => f.field === "stageId" && typeof f.value === "string")
      .map((f) => f.value as string),
  );
  const stages = new Map(
    stageIds.length
      ? (
          await db.crmStage.findMany({
            where: { organizationId, id: { in: stageIds } },
            select: { id: true, name: true },
          })
        ).map((s) => [s.id, s.name])
      : [],
  );
  const memberIds = changeGroups.flatMap((g) =>
    g.fields
      .filter((f) => f.field === "ownerId" && typeof f.value === "string")
      .map((f) => f.value as string),
  );
  const members = new Map(
    memberIds.length
      ? (
          await db.user.findMany({
            where: { id: { in: memberIds } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "a member"])
      : [],
  );
  const by = (m: { workflowId: string | null; enrollmentId: string | null }) =>
    m.workflowId
      ? workflows.get(m.workflowId)
        ? `From the automation "${workflows.get(m.workflowId)}"`
        : "An automation sent it"
      : m.enrollmentId
        ? `A step of "${sequences.get(m.enrollmentId) ?? "a sequence"}"`
        : "On its own";

  for (const m of mail) {
    const who = (m.personId && people.get(m.personId)) || "someone";
    if (m.status === "QUEUED") {
      const at = m.scheduledFor && m.scheduledFor > now ? m.scheduledFor : null;
      out.push({
        id: `mail:${m.id}`,
        kind: "sent",
        at: m.createdAt,
        text: `Sending ${quote(m.subject)} to ${who}${at ? ` at ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: options.tz ?? "UTC" })}` : ""}.`,
        why: by(m),
        undo: { type: "cancel-email", messageId: m.id },
        send: null,
      });
    } else if (m.status === "SENT") {
      out.push({
        id: `mail:${m.id}`,
        kind: "sent",
        at: m.sentAt ?? m.createdAt,
        text: `Sent ${quote(m.subject)} to ${who}.`,
        why: by(m),
        undo: null,
        send: null,
      });
    } else if (!NOT_HELD.has(m.error ?? "")) {
      out.push({
        id: `mail:${m.id}`,
        kind: "held",
        at: m.createdAt,
        text: `Held back ${quote(m.subject)} to ${who}.`,
        why: m.error ? m.error.replace(/\.$/, "") : by(m),
        undo: null,
        send: null,
      });
    }
  }

  for (const d of drafts) {
    const p = (d.payload ?? {}) as { subject?: string; body?: string; draftId?: string };
    const c = (d.citation ?? {}) as { label?: string };
    const who = (d.targetId && people.get(d.targetId)) || "someone";
    out.push({
      id: `draft:${d.id}`,
      kind: "held",
      at: d.createdAt,
      text: `Held ${quote(p.subject)} to ${who} for you to check.`,
      why: c.label ? `The automation "${c.label}" asks first` : "It asks first",
      undo: null,
      send:
        d.targetId && p.draftId && p.subject && p.body
          ? { personId: d.targetId, subject: p.subject, body: p.body, draftId: p.draftId }
          : null,
    });
  }

  for (const g of changeGroups) {
    const name =
      g.kind === "person"
        ? people.get(g.id)
        : g.kind === "company"
          ? companies.get(g.id)
          : deals.get(g.id);
    if (!name) continue; // gone, or not theirs to see
    const run = runs.find((r) => {
      const ref = (r.triggerRef ?? {}) as { id?: string };
      const end = (r.finishedAt ?? r.startedAt).getTime() + 10_000;
      return (
        ref.id === g.id &&
        r.startedAt.getTime() - 1000 <= g.first.getTime() &&
        g.first.getTime() <= end
      );
    });
    const why =
      g.source === "automation"
        ? run && workflows.get(run.workflowId)
          ? `From the automation "${workflows.get(run.workflowId)}"`
          : "An automation did it"
        : "From a booking or a reply";
    const stage = g.fields.find((f) => f.field === "stageId");
    const owner = g.fields.find((f) => f.field === "ownerId");
    const kind = g.kind as "person" | "company" | "deal";
    const created = g.fields.some((f) => f.field === "created");
    let text: string;
    if (created) text = `Added ${name}.`;
    else if (stage && g.fields.length === 1)
      text = `Moved ${name} to ${stages.get(String(stage.value)) ?? "another stage"}.`;
    else if (owner && g.fields.length === 1)
      text = owner.value
        ? `Gave ${name} to ${members.get(String(owner.value)) ?? "a member"}.`
        : `Took the owner off ${name}.`;
    else
      text = `Updated ${name}: ${list([...new Set(g.fields.map((f) => fieldWords(kind, f.field)))])}.`;
    const later = await db.crmFieldHistory.findFirst({
      where: { organizationId, targetKind: g.kind, targetId: g.id, changedAt: { gt: g.last } },
      select: { id: true },
    });
    out.push({
      id: `change:${g.kind}:${g.id}:${g.first.getTime()}`,
      kind: "changed",
      at: g.first,
      text,
      why,
      undo:
        later || created
          ? null
          : {
              type: "restore",
              kind: g.kind as "person" | "company" | "deal",
              id: g.id,
              before: new Date(g.first.getTime() - 1).toISOString(),
            },
      send: null,
    });
  }

  for (const r of runs) {
    const name = workflows.get(r.workflowId) ?? "an automation";
    const entries = Array.isArray(r.log)
      ? (r.log as { action?: string; ok?: boolean; detail?: string }[])
      : [];
    entries.forEach((e, i) => {
      if (!e.action || !e.detail || LISTED_ELSEWHERE.has(e.action)) return;
      if (e.ok && RUN_STEPS.has(e.action)) {
        out.push({
          id: `run:${r.id}:${i}`,
          kind: "changed",
          at: r.startedAt,
          text: e.detail,
          why: `From the automation "${name}"`,
          undo: null,
          send: null,
        });
      } else if (
        !e.ok &&
        e.action !== "trigger" &&
        e.action !== "conditions" &&
        !e.detail.startsWith("Failed")
      ) {
        out.push({
          id: `run:${r.id}:${i}`,
          kind: "held",
          at: r.startedAt,
          text: e.detail,
          why: `Skipped by "${name}"`,
          undo: null,
          send: null,
        });
      }
    });
  }

  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** "Today", "Yesterday" or "Oct 31", where the member is. */
export function dayLabel(at: Date, now: Date, tz: string): string {
  const key = localDateKey(at, tz);
  const today = localDateKey(now, tz);
  if (key === today) return "Today";
  if (key === addDaysToKey(today, -1)) return "Yesterday";
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
}
