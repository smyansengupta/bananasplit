import { displayText, type FieldDef } from "@/lib/databases/fields";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { formatMoney } from "@/lib/crm/fields";
import type { TargetRef } from "@/lib/crm/suggestions";
import type { TxClient } from "@/server/db/context";

import { timeline } from "./activity";
import { fenced } from "./ai";
import { customFieldsFor } from "./databases";

/**
 * What the CRM's AI is told about one record, read in the caller's
 * transaction (a member's RLS on the member path). The words people and
 * contacts wrote go in as data inside tags; ids, emails and phone numbers
 * stay out (the model never needs them, and the drafts' addresses are set
 * by us, not by it). Members are named, as on the page.
 */

export interface RecordContext {
  target: TargetRef;
  name: string;
  /** The record and its history as tagged text for a prompt. */
  text: string;
  /** For the stand-in and the screen: plain facts. */
  facts: {
    lastContactedAt: Date | null;
    nextFollowUpAt: Date | null;
    entries: number;
    lastEntry: string | null;
    openItems: string[];
    tasks: string[];
    upcoming: string[];
  };
  email: string | null;
  ownerId: string | null;
  companyName: string | null;
  title: string | null;
  today: string;
  timezone: string;
  /** The org's name, for drafts' sign-off. */
  orgName: string;
}

function day(d: Date | null | undefined, tz: string): string {
  return d ? zonedDateKey(d, tz) : "never";
}

function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function customLines(fields: readonly FieldDef[], custom: unknown, names: Map<string, string>): string[] {
  const values = custom && typeof custom === "object" ? (custom as Record<string, unknown>) : {};
  return fields
    .map((f) => {
      const v = displayText(f, values[f.id], names);
      return v ? `${f.name}: ${clip(v, 300)}` : null;
    })
    .filter((x): x is string => Boolean(x));
}

const LINK_KIND = { person: "crm-person", company: "crm-company", deal: "crm-deal" } as const;

/** One record's context; null when the reader can't see it. */
export async function recordContext(
  db: TxClient,
  organizationId: string,
  target: TargetRef,
  options: { timelineTake?: number } = {},
): Promise<RecordContext | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true } });
  const tz = safeTimeZone(org?.timezone);
  const members = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, user: { select: { name: true } } },
    take: 2000,
  });
  const names = new Map(members.map((m) => [m.userId, m.user.name ?? "A member"]));
  const lines: string[] = [];
  let name = "";
  let email: string | null = null;
  let ownerId: string | null = null;
  let companyName: string | null = null;
  let title: string | null = null;
  let lastContactedAt: Date | null = null;
  let nextFollowUpAt: Date | null = null;
  const openItems: string[] = [];
  if (target.kind === "person") {
    const p = await db.crmPerson.findFirst({
      where: { id: target.id, organizationId, deletedAt: null },
      include: {
        company: { select: { name: true } },
        deals: {
          select: {
            deal: {
              select: { title: true, amountCents: true, currency: true, closedAt: true, deletedAt: true, stage: { select: { name: true } }, pipeline: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!p) return null;
    name = p.name;
    email = p.primaryEmail;
    ownerId = p.ownerId;
    companyName = p.company?.name ?? null;
    title = p.title;
    lastContactedAt = p.lastContactedAt;
    nextFollowUpAt = p.nextFollowUpAt;
    lines.push(
      "Kind: person",
      `Name: ${p.name}`,
      p.title ? `Title: ${p.title}` : "",
      p.company ? `Company: ${p.company.name}` : "",
      p.location ? `Location: ${p.location}` : "",
      p.relationship ? `Relationship: ${p.relationship}` : "",
      `Status: ${p.status.toLowerCase()}`,
      p.ownerId ? `Owner: ${names.get(p.ownerId) ?? "a member"}` : "Owner: nobody",
      `Last contacted: ${day(p.lastContactedAt, tz)}`,
      p.nextFollowUpAt ? `Next follow-up: ${day(p.nextFollowUpAt, tz)}` : "",
      p.keepInTouchDays ? `Keep in touch every ${p.keepInTouchDays} days` : "",
      p.doNotContact ? "Do not contact: yes" : "",
      ...customLines(await customFieldsFor(db, organizationId, "person"), p.custom, names),
    );
    for (const d of p.deals) {
      if (d.deal.deletedAt) continue;
      const line = `${d.deal.pipeline.name}: ${d.deal.title} (${d.deal.stage.name}${d.deal.amountCents !== null ? `, ${formatMoney(d.deal.amountCents, d.deal.currency)}` : ""})`;
      if (!d.deal.closedAt) openItems.push(line);
      lines.push(`Item: ${line}`);
    }
  } else if (target.kind === "company") {
    const c = await db.crmCompany.findFirst({
      where: { id: target.id, organizationId, deletedAt: null },
      include: {
        people: { where: { deletedAt: null }, select: { name: true, title: true }, take: 30 },
        deals: {
          where: { deletedAt: null },
          select: { title: true, amountCents: true, currency: true, closedAt: true, stage: { select: { name: true } }, pipeline: { select: { name: true } } },
          take: 30,
        },
      },
    });
    if (!c) return null;
    name = c.name;
    ownerId = c.ownerId;
    companyName = c.name;
    lastContactedAt = c.lastContactedAt;
    nextFollowUpAt = c.nextFollowUpAt;
    lines.push(
      "Kind: company",
      `Name: ${c.name}`,
      c.domain ? `Domain: ${c.domain}` : "",
      c.industry ? `Industry: ${c.industry}` : "",
      c.size ? `Size: ${c.size}` : "",
      c.address ? `Address: ${c.address}` : "",
      c.description ? `About: ${clip(c.description, 600)}` : "",
      c.ownerId ? `Owner: ${names.get(c.ownerId) ?? "a member"}` : "Owner: nobody",
      `Last contacted: ${day(c.lastContactedAt, tz)}`,
      c.nextFollowUpAt ? `Next follow-up: ${day(c.nextFollowUpAt, tz)}` : "",
      ...c.people.map((p) => `Person there: ${p.name}${p.title ? `, ${p.title}` : ""}`),
      ...customLines(await customFieldsFor(db, organizationId, "company"), c.custom, names),
    );
    for (const d of c.deals) {
      const line = `${d.pipeline.name}: ${d.title} (${d.stage.name}${d.amountCents !== null ? `, ${formatMoney(d.amountCents, d.currency)}` : ""})`;
      if (!d.closedAt) openItems.push(line);
      lines.push(`Item: ${line}`);
    }
  } else {
    const d = await db.crmDeal.findFirst({
      where: { id: target.id, organizationId, deletedAt: null },
      include: {
        stage: { select: { name: true, kind: true } },
        pipeline: { select: { id: true, name: true, itemNoun: true } },
        company: { select: { name: true } },
        people: { select: { role: true, person: { select: { name: true, title: true } } } },
      },
    });
    if (!d) return null;
    name = d.title;
    ownerId = d.ownerId;
    companyName = d.company?.name ?? null;
    nextFollowUpAt = d.nextStepAt;
    lines.push(
      `Kind: ${d.pipeline.itemNoun} in the ${d.pipeline.name} pipeline`,
      `Title: ${d.title}`,
      `Stage: ${d.stage.name}${d.stage.kind !== "OPEN" ? ` (${d.stage.kind.toLowerCase()})` : ""}`,
      d.amountCents !== null ? `Amount: ${formatMoney(d.amountCents, d.currency)}` : "",
      d.expectedOn ? `Expected: ${day(d.expectedOn, tz)}` : "",
      d.company ? `Company: ${d.company.name}` : "",
      ...d.people.map((p) => `Person: ${p.person.name}${p.person.title ? `, ${p.person.title}` : ""}${p.role ? ` (${p.role})` : ""}`),
      d.nextStep ? `Next step: ${d.nextStep}${d.nextStepAt ? ` by ${day(d.nextStepAt, tz)}` : ""}` : "Next step: none",
      `In this stage since ${day(d.stageEnteredAt, tz)}`,
      d.ownerId ? `Owner: ${names.get(d.ownerId) ?? "a member"}` : "Owner: nobody",
      ...customLines(await customFieldsFor(db, organizationId, "deal", d.pipeline.id), d.custom, names),
    );
  }

  const entries = await timeline(db, organizationId, target, { take: options.timelineTake ?? 40 });
  const now = Date.now();
  const upcoming: string[] = [];
  const timelineLines = entries.map((e) => {
    const who = e.actorId ? ` with ${names.get(e.actorId) ?? "a member"}` : "";
    const line = `[${day(e.occurredAt, tz)}] ${e.kind.toLowerCase().replace(/_/g, " ")}${e.direction ? ` (${e.direction.toLowerCase()})` : ""}${who}: ${clip(e.subject, 200)}${e.body ? ` | ${clip(e.body, 700)}` : ""}`;
    if (e.occurredAt.getTime() > now && (e.kind === "MEETING" || e.kind === "TASK")) upcoming.push(line);
    return line;
  });

  // Tasks and files linked to it (the meeting brief's open tasks and files).
  const links = await db.itemLink.findMany({
    where: {
      organizationId,
      OR: [
        { toKind: LINK_KIND[target.kind], toId: target.id },
        { fromKind: LINK_KIND[target.kind], fromId: target.id },
      ],
    },
    select: { fromKind: true, fromId: true, toKind: true, toId: true },
    take: 100,
  });
  const other = links.map((l) => (l.toKind === LINK_KIND[target.kind] && l.toId === target.id ? { kind: l.fromKind, id: l.fromId } : { kind: l.toKind, id: l.toId }));
  const taskIds = other.filter((o) => o.kind === "task").map((o) => o.id);
  const tasks = taskIds.length
    ? await db.task.findMany({
        where: { organizationId, id: { in: taskIds }, deletedAt: null, status: { not: "COMPLETED" } },
        select: { title: true, dueDate: true, ownerId: true },
        take: 20,
      })
    : [];
  const taskLines = tasks.map(
    (t) => `${clip(t.title, 200)}${t.dueDate ? ` (due ${day(t.dueDate, tz)})` : ""}${t.ownerId ? `, ${names.get(t.ownerId) ?? "a member"}` : ""}`,
  );
  const fileIds = other.filter((o) => o.kind === "file").map((o) => o.id);
  const files = fileIds.length
    ? await db.orgFile.findMany({ where: { organizationId, id: { in: fileIds }, deletedAt: null }, select: { name: true }, take: 20 })
    : [];

  const text = [
    `<record>\n${fenced(lines.filter(Boolean).join("\n"), "record")}\n</record>`,
    `<timeline>\n${fenced(timelineLines.join("\n") || "Nothing logged yet.", "timeline")}\n</timeline>`,
    `<open_tasks>\n${fenced(taskLines.join("\n") || "None.", "open_tasks")}\n</open_tasks>`,
    `<files>\n${fenced(files.map((f) => f.name).join("\n") || "None.", "files")}\n</files>`,
  ].join("\n\n");

  return {
    target,
    name,
    text,
    facts: {
      lastContactedAt,
      nextFollowUpAt,
      entries: entries.length,
      lastEntry: timelineLines.find((l) => !upcoming.includes(l)) ?? null,
      openItems,
      tasks: taskLines,
      upcoming,
    },
    email,
    ownerId,
    companyName,
    title,
    today: zonedDateKey(new Date(), tz),
    timezone: tz,
    orgName: org?.name ?? "our organization",
  };
}
