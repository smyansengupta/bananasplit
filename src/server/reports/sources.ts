import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes, type SpaceInfo } from "@/lib/billing/space";
import { CHOICE_COLORS, displayText, type Choice, type FieldDef } from "@/lib/databases/fields";
import { dbViewHref } from "@/lib/databases/href";
import { sourceKind, type ReportField, type SourceSummary } from "@/lib/reports/catalog";
import type { LoadedSource, ReportRow } from "@/lib/reports/compute";
import { loadFields } from "@/server/databases/custom";
import { listDatabases } from "@/server/databases/views";
import type { TxClient } from "@/server/db/context";

import { reportTier } from "./tier";

/**
 * The sources a saved report can read, as the viewer may see them. Every
 * read runs in the viewer's own transaction, so RLS decides the rows: a
 * shared report shows each person the numbers of what THEY can see. Tasks
 * and Expenses are written as fields (Status, Owner, Amount...) so the same
 * widgets read them as any database.
 */

export interface SourceViewer {
  db: TxClient;
  organizationId: string;
  userId: string;
  role: Role;
  slug: string;
  space: SpaceInfo;
  /** The organization's add-ons (OrgSettings.addOns); left out, all count as added. */
  addOns?: readonly string[];
}

/** The newest rows a report reads; more than this and it says so. */
export const MAX_REPORT_ROWS = 5000;

/** Choice labels that mean a row is finished, for Overdue and stale. */
const DONE =
  /^(done|complete|completed|returned|paid|closed|won|lost|declined|cancell?ed|rejected|finished|archived|reimbursed)$/i;

function withDone(f: FieldDef): ReportField {
  const choices = f.options.choices;
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    ...(choices
      ? { choices, done: choices.filter((c) => DONE.test(c.label.trim())).map((c) => c.id) }
      : {}),
  };
}

const TASK_STATUS: Choice[] = [
  { id: "NOT_STARTED", label: "Not started", color: "gray" },
  { id: "IN_PROGRESS", label: "In progress", color: "blue" },
  { id: "BLOCKED", label: "Blocked", color: "red" },
  { id: "COMPLETED", label: "Completed", color: "green" },
];
const TASK_PRIORITY: Choice[] = [
  { id: "HIGH", label: "High", color: "red" },
  { id: "MEDIUM", label: "Medium", color: "yellow" },
  { id: "LOW", label: "Low", color: "gray" },
];
const TASK_FIELDS: ReportField[] = [
  {
    id: "status",
    name: "Status",
    type: "SELECT",
    choices: TASK_STATUS,
    done: ["COMPLETED"],
    stages: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"],
  },
  { id: "priority", name: "Priority", type: "SELECT", choices: TASK_PRIORITY },
  { id: "owner", name: "Owner", type: "MEMBER" },
  { id: "due", name: "Due date", type: "DATE" },
  { id: "completed", name: "Completed on", type: "DATE" },
];

const EXPENSE_STATUS: Choice[] = [
  { id: "DRAFT", label: "Draft", color: "gray" },
  { id: "SUBMITTED", label: "Submitted", color: "yellow" },
  { id: "APPROVED", label: "Approved", color: "blue" },
  { id: "REIMBURSED", label: "Reimbursed", color: "green" },
  { id: "REJECTED", label: "Rejected", color: "red" },
  { id: "NOT_APPLICABLE", label: "Paid directly", color: "teal" },
];

function expenseFields(categories: Choice[]): ReportField[] {
  return [
    { id: "amount", name: "Amount", type: "CURRENCY" },
    { id: "category", name: "Category", type: "SELECT", choices: categories },
    { id: "date", name: "Date", type: "DATE" },
    {
      id: "status",
      name: "Reimbursement status",
      type: "SELECT",
      choices: EXPENSE_STATUS,
      done: ["REIMBURSED", "REJECTED", "NOT_APPLICABLE"],
      stages: ["DRAFT", "SUBMITTED", "APPROVED", "REIMBURSED"],
    },
    { id: "submittedBy", name: "Submitted by", type: "MEMBER" },
    { id: "payee", name: "Paid to", type: "TEXT" },
  ];
}

/**
 * A category's choice id from its name: every budget period has its own copy
 * of a category, so they're grouped by name. A hash, so "Food & Drink" and
 * "Food + Drink", or two names in another script, never share one.
 */
function categoryId(name: string): string {
  let h = 0x811c9dc5;
  for (const ch of name) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `c${h.toString(36)}`;
}

function localDate(d: Date | null, tz: string): string | undefined {
  if (!d) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function categoryChoices(v: SourceViewer): Promise<Choice[]> {
  const rows = await v.db.budgetCategory.findMany({
    where: { organizationId: v.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  // One entry per name: every budget period has its own copy of a category.
  const byName = new Map<string, Choice>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, {
        id: categoryId(key),
        label: r.name,
        color: CHOICE_COLORS[(byName.size + 6) % CHOICE_COLORS.length],
      });
    }
  }
  return [...byName.values()];
}

function canFinance(v: SourceViewer): boolean {
  return (
    spaceIncludes(v.space, "finance") &&
    can({ role: v.role }, "finance.manage") &&
    (v.addOns?.includes("finance") ?? true)
  );
}

/** One listing per viewer per transaction: a page that runs many reports reads it once. */
const listed = new WeakMap<TxClient, Map<string, Promise<SourceSummary[]>>>();

/** Everything the viewer may report on, for Reports home and the walkthrough's first step. */
export function listSources(v: SourceViewer): Promise<SourceSummary[]> {
  let byUser = listed.get(v.db);
  if (!byUser) {
    byUser = new Map();
    listed.set(v.db, byUser);
  }
  let found = byUser.get(v.userId);
  if (!found) {
    found = readSources(v);
    byUser.set(v.userId, found);
  }
  return found;
}

async function readSources(v: SourceViewer): Promise<SourceSummary[]> {
  const { db, organizationId, slug } = v;
  const base = `/app/${slug}`;
  const out: SourceSummary[] = [];
  const defs = await listDatabases(db, organizationId, v.role);
  const forms = await db.form.findMany({
    where: { organizationId, databaseId: { in: defs.map((d) => d.id) } },
    select: { id: true, title: true, databaseId: true },
    orderBy: { createdAt: "asc" },
  });
  for (const d of defs) {
    if (d.kind !== "CUSTOM") continue;
    const fields = (await loadFields(db, organizationId, d.id)).map(withDone);
    const rows = await db.databaseRecord.count({
      where: { organizationId, databaseId: d.id, deletedAt: null },
    });
    const form = forms.find((f) => f.databaseId === d.id);
    out.push({
      key: `custom:${d.id}`,
      kind: "custom",
      name: d.name,
      icon: d.icon ?? "Table2",
      description: d.description ?? (form ? `Answers to ${form.title}` : "Your own database"),
      href: dbViewHref(slug, d.key),
      fields,
      rows,
      form: form ? { title: form.title, href: `${base}/forms/${form.id}` } : null,
    });
  }
  if (spaceIncludes(v.space, "tasks")) {
    out.push({
      key: "tasks",
      kind: "tasks",
      name: "Tasks",
      icon: "CheckSquare",
      description: "Everything your organization is working on",
      href: `${base}/tasks`,
      fields: TASK_FIELDS,
      rows: await db.task.count({
        where: { organizationId, deletedAt: null, type: { not: "EPIC" } },
      }),
      form: null,
    });
  }
  if (canFinance(v)) {
    out.push({
      key: "expenses",
      kind: "expenses",
      name: "Expenses",
      icon: "ReceiptText",
      description: "Money out, by category and reimbursement",
      href: `${base}/finance/transactions`,
      fields: expenseFields(await categoryChoices(v)),
      rows: await db.transaction.count({
        where: { organizationId, direction: "OUT", voidedAt: null },
      }),
      form: null,
    });
  }
  // People and Events read the built-in reports, which have their own tiers.
  if (spaceIncludes(v.space, "reports") && reportTier(v.role)) {
    const sessions = defs.find((d) => d.kind === "SESSIONS");
    if (sessions && defs.some((d) => d.kind === "ATTENDANCE")) {
      out.push({
        key: "events",
        kind: "events",
        name: "Events and attendance",
        icon: "CalendarDays",
        description: "Check-ins, RSVPs and who comes back",
        href: dbViewHref(slug, sessions.key),
        fields: [],
        rows: await db.event.count({
          where: { organizationId, deletedAt: null, mergedIntoId: null },
        }),
        form: null,
      });
    }
    const people = defs.find((d) => d.kind === "PEOPLE");
    if (people) {
      out.push({
        key: "people",
        kind: "people",
        name: "People",
        icon: "Users",
        description: "Members, the board and who's new",
        href: `${base}/people`,
        fields: [],
        rows: await db.contact.count({ where: { organizationId, sessionsAttended: { gt: 0 } } }),
        form: null,
      });
    }
  }
  return out;
}

async function memberNames(v: SourceViewer): Promise<Record<string, string>> {
  const rows = await v.db.membership.findMany({
    where: { organizationId: v.organizationId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return Object.fromEntries(
    rows.map((m) => [m.user.id, m.user.name ?? m.user.email?.split("@")[0] ?? "Member"]),
  );
}

/** One source with its rows (the newest MAX_REPORT_ROWS), or null when the viewer can't see it. */
export async function loadSource(
  v: SourceViewer,
  key: string,
  tz: string,
): Promise<LoadedSource | null> {
  const summary = (await listSources(v)).find((s) => s.key === key);
  if (!summary) return null;
  const { db, organizationId, slug } = v;
  const members = await memberNames(v);
  const names = new Map(Object.entries(members));
  const base = `/app/${slug}`;
  let records: ReportRow[] = [];
  const take = MAX_REPORT_ROWS + 1;

  switch (sourceKind(key)) {
    case "custom": {
      const databaseId = key.slice("custom:".length);
      const fields = await loadFields(db, organizationId, databaseId);
      const primary = fields.find((f) => f.isPrimary) ?? fields[0];
      const rows = await db.databaseRecord.findMany({
        where: { organizationId, databaseId, deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        select: { id: true, values: true, createdAt: true, updatedAt: true },
      });
      records = rows.map((r) => {
        const values = (r.values && typeof r.values === "object" ? r.values : {}) as Record<
          string,
          unknown
        >;
        return {
          id: r.id,
          title: primary ? displayText(primary, values[primary.id], names) : "",
          values,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          href: summary.href,
        };
      });
      break;
    }
    case "tasks": {
      const rows = await db.task.findMany({
        where: { organizationId, deletedAt: null, type: { not: "EPIC" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          ownerId: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      records = rows.map((t) => ({
        id: t.id,
        title: t.title,
        values: {
          status: t.status,
          priority: t.priority,
          ...(t.ownerId ? { owner: t.ownerId } : {}),
          ...(t.dueDate ? { due: localDate(t.dueDate, tz) } : {}),
          ...(t.completedAt ? { completed: localDate(t.completedAt, tz) } : {}),
        },
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        href: `${base}/tasks/${t.id}`,
      }));
      break;
    }
    case "expenses": {
      const categories = new Map(
        (
          await db.budgetCategory.findMany({
            where: { organizationId },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, categoryId(c.name.trim().toLowerCase())]),
      );
      const rows = await db.transaction.findMany({
        where: { organizationId, direction: "OUT", voidedAt: null },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take,
        select: {
          id: true,
          description: true,
          amountCents: true,
          categoryId: true,
          occurredAt: true,
          status: true,
          submittedById: true,
          counterparty: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      records = rows.map((t) => ({
        id: t.id,
        title: t.description,
        values: {
          amount: t.amountCents / 100,
          ...(t.categoryId && categories.has(t.categoryId)
            ? { category: categories.get(t.categoryId) }
            : {}),
          date: localDate(t.occurredAt, tz),
          status: t.status,
          submittedBy: t.submittedById,
          ...(t.counterparty ? { payee: t.counterparty } : {}),
        },
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        href: `${base}/finance/transactions`,
      }));
      break;
    }
    default:
      break;
  }
  const truncated = records.length > MAX_REPORT_ROWS;
  // Oldest first, as every widget reads them.
  return { ...summary, records: records.slice(0, MAX_REPORT_ROWS).reverse(), members, truncated };
}
