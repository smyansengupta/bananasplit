import type { LinkRef, PeekSummary } from "@/lib/links";

export type { PeekSummary };
import type { TxClient } from "@/server/db/context";

import { resolveRefs } from "./links";

const TEXT_MAX = 700;

function clip(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX).trimEnd()}…` : t;
}

function show(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.map(show).filter(Boolean).join(", ") || null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return null;
  return String(value);
}

export async function peekRef(
  db: TxClient,
  orgId: string,
  orgSlug: string,
  ref: LinkRef,
  timeZone = "UTC",
): Promise<PeekSummary | null> {
  const resolved = (await resolveRefs(db, orgId, orgSlug, [ref], timeZone)).get(
    `${ref.kind}:${ref.id}`,
  );
  if (!resolved) return null;
  const base: PeekSummary = { ...resolved, facts: [], text: null };
  const when = (d: Date, allDay = false, dateOnly = false) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }),
      // A task's due date is a calendar day stored as midnight UTC.
      timeZone: dateOnly ? "UTC" : timeZone,
    }).format(d);
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const fact = (label: string, value: string | null | undefined) =>
    value ? base.facts.push({ label, value }) : undefined;

  switch (ref.kind) {
    case "task": {
      const t = await db.task.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: {
          description: true,
          status: true,
          dueDate: true,
          owner: { select: { name: true } },
          parentTask: { select: { title: true } },
          assignees: { select: { user: { select: { name: true } } } },
        },
      });
      if (!t) return null;
      fact(
        "Status",
        {
          NOT_STARTED: "Not started",
          IN_PROGRESS: "In progress",
          BLOCKED: "Blocked",
          COMPLETED: "Done",
        }[t.status],
      );
      fact("Owner", t.owner?.name);
      fact("Due", t.dueDate ? when(t.dueDate, true, true) : null);
      fact("Part of", t.parentTask?.title);
      fact(
        "Involved",
        t.assignees
          .map((a) => a.user.name)
          .filter(Boolean)
          .join(", ") || null,
      );
      base.text = clip(t.description);
      break;
    }
    case "event": {
      const e = await db.event.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: { description: true, startsAt: true, allDay: true, location: true },
      });
      if (!e) return null;
      fact("When", when(e.startsAt, e.allDay));
      fact("Where", e.location?.trim());
      base.text = clip(e.description);
      break;
    }
    case "note": {
      const n = await db.note.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: { contentText: true, author: { select: { name: true } } },
      });
      if (!n) return null;
      fact("By", n.author.name);
      base.text = clip(n.contentText);
      break;
    }
    case "file": {
      const f = await db.orgFile.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: { contentType: true, createdAt: true, uploadedBy: { select: { name: true } } },
      });
      if (!f) return null;
      fact("Type", f.contentType);
      fact("Added by", f.uploadedBy.name);
      fact("Added", when(f.createdAt, true));
      break;
    }
    case "person": {
      const m = await db.membership.findFirst({
        where: { organizationId: orgId, userId: ref.id },
        select: { title: true, role: true, user: { select: { pronouns: true, bio: true } } },
      });
      if (!m) return null;
      fact("Title", m.title);
      fact("Role", m.role.charAt(0) + m.role.slice(1).toLowerCase());
      fact("Pronouns", m.user.pronouns);
      base.text = clip(m.user.bio);
      break;
    }
    case "database": {
      const d = await db.databaseDefinition.findFirst({
        where: { organizationId: orgId, key: ref.id },
        select: { description: true },
      });
      if (!d) return null;
      base.text = clip(d.description);
      break;
    }
    case "transaction": {
      const t = await db.transaction.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: {
          amountCents: true,
          direction: true,
          occurredAt: true,
          counterparty: true,
          category: { select: { name: true } },
          submittedBy: { select: { name: true } },
        },
      });
      if (!t) return null;
      fact("Amount", `${t.direction === "IN" ? "+" : "−"}${money(t.amountCents)}`);
      fact("Date", when(t.occurredAt, true));
      fact("Category", t.category?.name);
      fact(t.direction === "IN" ? "From" : "Paid to", t.counterparty);
      fact("Logged by", t.submittedBy?.name);
      break;
    }
    case "budget": {
      const c = await db.budgetCategory.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: { allocatedCents: true, budgetPeriod: { select: { label: true } } },
      });
      if (!c) return null;
      fact("Budgeted", money(c.allocatedCents));
      fact("Period", c.budgetPeriod.label);
      break;
    }
    case "form": {
      const f = await db.form.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: { description: true, closedAt: true, closesAt: true, access: true },
      });
      if (!f) return null;
      const closed = f.closedAt || (f.closesAt && f.closesAt.getTime() <= Date.now());
      fact("Status", closed ? "Closed" : f.closesAt ? `Open until ${when(f.closesAt)}` : "Open");
      fact(
        "Who answers",
        f.access === "ANYONE"
          ? "Anyone with the link"
          : f.access === "MEMBERS"
            ? "Members"
            : "Signed in",
      );
      base.text = clip(f.description);
      break;
    }
    case "record": {
      const r = await db.databaseRecord.findFirst({
        where: { organizationId: orgId, id: ref.id },
        select: {
          values: true,
          database: {
            select: {
              fields: { select: { id: true, name: true }, orderBy: { sortOrder: "asc" }, take: 8 },
            },
          },
        },
      });
      if (!r) return null;
      const values = (r.values ?? {}) as Record<string, unknown>;
      for (const f of r.database.fields.slice(1)) fact(f.name, show(values[f.id]));
      break;
    }
  }
  return base;
}
