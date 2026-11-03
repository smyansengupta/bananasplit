import { defineColumns, type Cell, type ColumnConfigInput } from "@/components/databases/column-config";
import { DatabaseKind, type Prisma } from "@/generated/prisma/client";
import { displayText, readRelation, type FieldDef } from "@/lib/databases/fields";
import { crmRecordHref } from "@/lib/crm/href";
import { formatMoney, STATUS_LABELS, type RecordStatus } from "@/lib/crm/fields";
import { resolveRelationLabels } from "@/server/databases/relations";
import type { TxClient } from "@/server/db/context";

import { csvDate, dateCell, num, text } from "../format";
import type { FieldSpec, QuerySpec } from "../query-builder";
import type { DatabaseSource, MappedRow, ViewContext } from "../types";

/**
 * The CRM's databases in Databases (docs/features/crm.md, "How it fits into
 * Databases"): People, Companies and each pipeline, read from the CRM's own
 * typed tables with their custom fields (DatabaseField rows on the
 * definition, values in each row's `custom` JSON) as more columns. They get
 * the same table, filters, sort, search and CSV export as every database,
 * under the viewer's RLS (OWN access applies here too), and a row opens the
 * CRM record itself: one row, one record.
 *
 * Custom columns filter (equals, contains, more or less than) but don't
 * sort: Prisma can't order by a JSON path.
 */

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

function customKey(fieldId: string): string {
  return `cf_${fieldId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function customColumn(f: FieldDef): ColumnConfigInput {
  const base = { key: customKey(f.id), label: f.name.slice(0, 80), filterable: true, hiddenByDefault: false };
  switch (f.type) {
    case "NUMBER":
    case "CURRENCY":
      return { ...base, type: "number", align: "right" };
    case "DATE":
      return { ...base, type: "date" };
    case "CHECKBOX":
      return { ...base, type: "boolean" };
    case "SELECT":
      return { ...base, type: "select", options: (f.options.choices ?? []).map((c) => ({ value: c.id, label: c.label })) };
    case "MULTI_SELECT":
      return { ...base, type: "multiselect", options: (f.options.choices ?? []).map((c) => ({ value: c.id, label: c.label })) };
    case "EMAIL":
      return { ...base, type: "email" };
    case "URL":
      return { ...base, type: "url" };
    case "LONG_TEXT":
      return { ...base, type: "longtext", filterable: false };
    case "RELATION":
      return { ...base, type: "relation", filterable: false };
    default:
      return { ...base, type: "text" };
  }
}

function customSpec(f: FieldDef): FieldSpec {
  const path = [f.id];
  const json = (cond: Record<string, unknown>) => ({ custom: { path, ...cond } });
  switch (f.type) {
    case "NUMBER":
    case "CURRENCY":
      return {
        path: ["custom"],
        kind: "float",
        filterable: true,
        ops: ["eq", "gt", "gte", "lt", "lte"],
        where: (op, v) =>
          typeof v !== "number" ? null : json(op === "eq" ? { equals: v } : { [op]: v }),
      };
    case "CHECKBOX":
      return {
        path: ["custom"],
        kind: "boolean",
        filterable: true,
        ops: ["eq"],
        where: (_op, v) => (v === true ? json({ equals: true }) : { NOT: json({ equals: true }) }),
      };
    case "SELECT":
      return {
        path: ["custom"],
        kind: "string",
        filterable: true,
        ops: ["eq"],
        where: (_op, v) => (typeof v === "string" ? json({ equals: v }) : null),
      };
    case "MULTI_SELECT":
      return {
        path: ["custom"],
        kind: "string",
        filterable: true,
        ops: ["eq", "contains"],
        where: (_op, v) => (typeof v === "string" ? json({ array_contains: [v] }) : null),
      };
    case "DATE":
      return {
        path: ["custom"],
        kind: "string",
        filterable: true,
        ops: ["eq", "gt", "lt"],
        where: (op, v) =>
          typeof v !== "string" ? null : json(op === "eq" ? { equals: v } : op === "gt" ? { gt: v } : { lt: v }),
      };
    default:
      return {
        path: ["custom"],
        kind: "text",
        filterable: true,
        ops: ["contains", "eq"],
        where: (op, v) =>
          typeof v !== "string" ? null : json(op === "eq" ? { equals: v } : { string_contains: v }),
      };
  }
}

function customCell(f: FieldDef, value: unknown, names: ReadonlyMap<string, string>, labels: ReadonlyMap<string, string>): Cell {
  if (value === undefined || value === null) return null;
  switch (f.type) {
    case "NUMBER":
      return num(typeof value === "number" ? value : null);
    case "CURRENCY":
      return { t: "number", v: typeof value === "number" ? value : null, text: displayText(f, value, names) };
    case "CHECKBOX":
      return { t: "bool", v: value === true };
    case "SELECT":
      return { t: "badge", v: displayText(f, value, names), tone: "secondary" };
    case "MULTI_SELECT":
      return { t: "badges", v: displayText(f, value, names).split(", ").filter(Boolean) };
    case "RELATION": {
      const refs = readRelation(value);
      const names2 = refs.map((r) => labels.get(`${r.kind}:${r.id}`)).filter(Boolean) as string[];
      return text(names2.join(", ") || displayText(f, value, names));
    }
    default:
      return text(displayText(f, value, names));
  }
}

function customCsv(f: FieldDef, value: unknown, names: ReadonlyMap<string, string>, labels: ReadonlyMap<string, string>) {
  if (f.type === "RELATION") {
    return readRelation(value)
      .map((r) => labels.get(`${r.kind}:${r.id}`) ?? "")
      .filter(Boolean)
      .join("; ");
  }
  return displayText(f, value, names);
}

async function memberNames(db: TxClient, organizationId: string): Promise<Map<string, string>> {
  const rows = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.userId, r.user.name ?? "Member"]));
}

async function relationLabels(
  db: TxClient,
  organizationId: string,
  fields: readonly FieldDef[],
  rows: readonly { custom: unknown }[],
): Promise<Map<string, string>> {
  const rel = fields.filter((f) => f.type === "RELATION");
  if (rel.length === 0) return new Map();
  const refs = rows.flatMap((r) => rel.flatMap((f) => readRelation(((r.custom ?? {}) as Record<string, unknown>)[f.id])));
  const resolved = await resolveRelationLabels(db, organizationId, refs);
  return new Map([...resolved.entries()].map(([k, v]) => [k, v.label]));
}

function customParts(fields: readonly FieldDef[]) {
  const columns = fields.map(customColumn);
  const specs = Object.fromEntries(fields.map((f) => [customKey(f.id), customSpec(f)]));
  return { columns, specs };
}

const owner = (names: ReadonlyMap<string, string>, id: string | null) => (id ? (names.get(id) ?? "A former member") : "");

// ---- People -------------------------------------------------------------------

const personSelect = {
  id: true,
  name: true,
  primaryEmail: true,
  phone: true,
  title: true,
  relationship: true,
  status: true,
  ownerId: true,
  source: true,
  lastContactedAt: true,
  nextFollowUpAt: true,
  strength: true,
  score: true,
  createdAt: true,
  custom: true,
  company: { select: { name: true } },
} satisfies Prisma.CrmPersonSelect;

export function crmPeopleSource(fields: readonly FieldDef[], relationships: readonly { id: string; label: string }[] = []): DatabaseSource {
  const custom = customParts(fields);
  const relLabel = new Map(relationships.map((r) => [r.id, r.label]));
  const columns = defineColumns([
    { key: "name", label: "Name", type: "link", sortable: true, filterable: true, searchable: true },
    { key: "email", label: "Email", type: "email", filterable: true, pii: true },
    { key: "phone", label: "Phone", type: "text", hiddenByDefault: true, pii: true },
    { key: "title", label: "Title", type: "text", sortable: true, filterable: true },
    { key: "company", label: "Company", type: "text", sortable: true, filterable: true },
    {
      key: "relationship",
      label: "Relationship",
      type: "select",
      filterable: true,
      options: relationships.map((r) => ({ value: r.id, label: r.label })),
    },
    { key: "status", label: "Status", type: "select", filterable: true, options: STATUS_OPTIONS },
    { key: "owner", label: "Owner", type: "text", filterable: true },
    { key: "lastContactedAt", label: "Last contacted", type: "date", sortable: true, filterable: true },
    { key: "nextFollowUpAt", label: "Next follow-up", type: "date", sortable: true, filterable: true },
    { key: "strength", label: "Strength", type: "number", sortable: true, filterable: true, align: "right" },
    { key: "score", label: "Score", type: "number", sortable: true, filterable: true, align: "right", hiddenByDefault: true },
    { key: "source", label: "Source", type: "text", filterable: true, hiddenByDefault: true },
    { key: "createdAt", label: "Added", type: "date", sortable: true, filterable: true, hiddenByDefault: true },
    ...custom.columns,
  ]);
  const query = (_ctx: ViewContext): QuerySpec => ({
    fields: {
      name: { path: ["name"], kind: "text", sortable: true, filterable: true },
      email: { path: ["primaryEmail"], kind: "string", nullable: true, filterable: true, ops: ["eq", "contains", "isnull"] },
      title: { path: ["title"], kind: "text", nullable: true, sortable: true, filterable: true },
      company: { path: ["company", "name"], kind: "text", nullable: true, sortable: true, filterable: true },
      relationship: { path: ["relationship"], kind: "string", nullable: true, filterable: true, ops: ["eq", "neq", "in", "isnull"] },
      status: { path: ["status"], kind: "enum", enumValues: ["ACTIVE", "INACTIVE", "ALUMNI"], filterable: true },
      owner: { path: ["ownerId"], kind: "string", nullable: true, filterable: true, ops: ["eq", "isnull"] },
      lastContactedAt: { path: ["lastContactedAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      nextFollowUpAt: { path: ["nextFollowUpAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      strength: { path: ["strength"], kind: "int", sortable: true, filterable: true },
      score: { path: ["score"], kind: "int", sortable: true, filterable: true },
      source: { path: ["source"], kind: "text", nullable: true, filterable: true },
      createdAt: { path: ["createdAt"], kind: "datetime", sortable: true, filterable: true },
      ...custom.specs,
    },
    aliases: { followUp: "nextFollowUpAt", lastContacted: "lastContactedAt", rel: "relationship" },
    search: ["name", "title"],
    searchExtra: (q) => [
      { emails: { some: { email: { contains: q.toLowerCase() } } } },
      { company: { name: { contains: q, mode: "insensitive" } } },
    ],
    dateField: "createdAt",
    defaultSort: { col: "name", dir: "asc" },
    tiebreak: (dir) => [{ id: dir }],
  });
  return {
    kind: DatabaseKind.CRM_PEOPLE,
    columns,
    query,
    baseWhere: (ctx) => ({ organizationId: ctx.organizationId, deletedAt: null }),
    async list(db, args, ctx) {
      const rows = await db.crmPerson.findMany({
        where: args.where as Prisma.CrmPersonWhereInput,
        orderBy: args.orderBy as Prisma.CrmPersonOrderByWithRelationInput[],
        skip: args.skip,
        take: args.take,
        ...(args.cursor ? { cursor: args.cursor as Prisma.CrmPersonWhereUniqueInput, skip: 1 } : {}),
        select: personSelect,
      });
      const names = await memberNames(db, ctx.organizationId);
      const labels = await relationLabels(db, ctx.organizationId, fields, rows);
      return rows.map((p): MappedRow => {
        const values = (p.custom ?? {}) as Record<string, unknown>;
        return {
          id: p.id,
          cursor: { id: p.id },
          cells: {
            name: { t: "link", href: crmRecordHref(ctx.orgSlug, "person", p.id), label: p.name },
            email: text(p.primaryEmail),
            phone: text(p.phone),
            title: text(p.title),
            company: text(p.company?.name ?? null),
            relationship: p.relationship ? { t: "badge", v: relLabel.get(p.relationship) ?? p.relationship, tone: "secondary" } : null,
            status: { t: "badge", v: STATUS_LABELS[p.status as RecordStatus], tone: p.status === "ACTIVE" ? "success" : "outline" },
            owner: text(owner(names, p.ownerId) || null),
            lastContactedAt: dateCell(p.lastContactedAt, ctx.timezone),
            nextFollowUpAt: dateCell(p.nextFollowUpAt, ctx.timezone),
            strength: num(p.strength),
            score: num(p.score),
            source: text(p.source),
            createdAt: dateCell(p.createdAt, ctx.timezone),
            ...Object.fromEntries(fields.map((f) => [customKey(f.id), customCell(f, values[f.id], names, labels)])),
          },
          csv: {
            name: p.name,
            email: p.primaryEmail,
            phone: p.phone,
            title: p.title,
            company: p.company?.name ?? null,
            relationship: p.relationship ? (relLabel.get(p.relationship) ?? p.relationship) : null,
            status: STATUS_LABELS[p.status as RecordStatus],
            owner: owner(names, p.ownerId),
            lastContactedAt: csvDate(p.lastContactedAt, ctx.timezone),
            nextFollowUpAt: csvDate(p.nextFollowUpAt, ctx.timezone),
            strength: p.strength,
            score: p.score,
            source: p.source,
            createdAt: csvDate(p.createdAt, ctx.timezone),
            ...Object.fromEntries(fields.map((f) => [customKey(f.id), customCsv(f, values[f.id], names, labels)])),
          },
        };
      });
    },
    count: (db, where) => db.crmPerson.count({ where: where as Prisma.CrmPersonWhereInput }),
  };
}

// ---- Companies ------------------------------------------------------------------

export function crmCompaniesSource(fields: readonly FieldDef[]): DatabaseSource {
  const custom = customParts(fields);
  const columns = defineColumns([
    { key: "name", label: "Name", type: "link", sortable: true, filterable: true, searchable: true },
    { key: "domain", label: "Domain", type: "text", sortable: true, filterable: true },
    { key: "industry", label: "Industry", type: "text", sortable: true, filterable: true },
    { key: "size", label: "Size", type: "text", filterable: true, hiddenByDefault: true },
    { key: "status", label: "Status", type: "select", filterable: true, options: STATUS_OPTIONS },
    { key: "owner", label: "Owner", type: "text", filterable: true },
    { key: "people", label: "People", type: "number", align: "right" },
    { key: "lastContactedAt", label: "Last contacted", type: "date", sortable: true, filterable: true },
    { key: "strength", label: "Strength", type: "number", sortable: true, filterable: true, align: "right" },
    { key: "createdAt", label: "Added", type: "date", sortable: true, filterable: true, hiddenByDefault: true },
    ...custom.columns,
  ]);
  const query = (): QuerySpec => ({
    fields: {
      name: { path: ["name"], kind: "text", sortable: true, filterable: true },
      domain: { path: ["domain"], kind: "string", nullable: true, sortable: true, filterable: true, ops: ["eq", "contains", "isnull"] },
      industry: { path: ["industry"], kind: "text", nullable: true, sortable: true, filterable: true },
      size: { path: ["size"], kind: "text", nullable: true, filterable: true },
      status: { path: ["status"], kind: "enum", enumValues: ["ACTIVE", "INACTIVE", "ALUMNI"], filterable: true },
      owner: { path: ["ownerId"], kind: "string", nullable: true, filterable: true, ops: ["eq", "isnull"] },
      lastContactedAt: { path: ["lastContactedAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      strength: { path: ["strength"], kind: "int", sortable: true, filterable: true },
      createdAt: { path: ["createdAt"], kind: "datetime", sortable: true, filterable: true },
      ...custom.specs,
    },
    search: ["name", "industry"],
    searchExtra: (q) => [{ domain: { contains: q.toLowerCase() } }],
    dateField: "createdAt",
    defaultSort: { col: "name", dir: "asc" },
    tiebreak: (dir) => [{ id: dir }],
  });
  return {
    kind: DatabaseKind.CRM_COMPANIES,
    columns,
    query,
    baseWhere: (ctx) => ({ organizationId: ctx.organizationId, deletedAt: null }),
    async list(db, args, ctx) {
      const rows = await db.crmCompany.findMany({
        where: args.where as Prisma.CrmCompanyWhereInput,
        orderBy: args.orderBy as Prisma.CrmCompanyOrderByWithRelationInput[],
        skip: args.skip,
        take: args.take,
        ...(args.cursor ? { cursor: args.cursor as Prisma.CrmCompanyWhereUniqueInput, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          domain: true,
          industry: true,
          size: true,
          status: true,
          ownerId: true,
          lastContactedAt: true,
          strength: true,
          createdAt: true,
          custom: true,
          _count: { select: { people: { where: { deletedAt: null } } } },
        },
      });
      const names = await memberNames(db, ctx.organizationId);
      const labels = await relationLabels(db, ctx.organizationId, fields, rows);
      return rows.map((c): MappedRow => {
        const values = (c.custom ?? {}) as Record<string, unknown>;
        return {
          id: c.id,
          cursor: { id: c.id },
          cells: {
            name: { t: "link", href: crmRecordHref(ctx.orgSlug, "company", c.id), label: c.name },
            domain: text(c.domain),
            industry: text(c.industry),
            size: text(c.size),
            status: { t: "badge", v: STATUS_LABELS[c.status as RecordStatus], tone: c.status === "ACTIVE" ? "success" : "outline" },
            owner: text(owner(names, c.ownerId) || null),
            people: num(c._count.people),
            lastContactedAt: dateCell(c.lastContactedAt, ctx.timezone),
            strength: num(c.strength),
            createdAt: dateCell(c.createdAt, ctx.timezone),
            ...Object.fromEntries(fields.map((f) => [customKey(f.id), customCell(f, values[f.id], names, labels)])),
          },
          csv: {
            name: c.name,
            domain: c.domain,
            industry: c.industry,
            size: c.size,
            status: STATUS_LABELS[c.status as RecordStatus],
            owner: owner(names, c.ownerId),
            people: c._count.people,
            lastContactedAt: csvDate(c.lastContactedAt, ctx.timezone),
            strength: c.strength,
            createdAt: csvDate(c.createdAt, ctx.timezone),
            ...Object.fromEntries(fields.map((f) => [customKey(f.id), customCsv(f, values[f.id], names, labels)])),
          },
        };
      });
    },
    count: (db, where) => db.crmCompany.count({ where: where as Prisma.CrmCompanyWhereInput }),
  };
}

// ---- One pipeline ------------------------------------------------------------------

export interface PipelineSourceInfo {
  id: string;
  itemNoun: string;
  stages: { id: string; name: string; kind: string }[];
  hasAmount: boolean;
}

export function crmPipelineSource(pipeline: PipelineSourceInfo, fields: readonly FieldDef[]): DatabaseSource {
  const custom = customParts(fields);
  const stageName = new Map(pipeline.stages.map((s) => [s.id, s.name]));
  const columns = defineColumns([
    { key: "title", label: "Title", type: "link", sortable: true, filterable: true, searchable: true },
    {
      key: "stage",
      label: "Stage",
      type: "select",
      filterable: true,
      options: pipeline.stages.map((s) => ({ value: s.id, label: s.name })),
    },
    ...(pipeline.hasAmount
      ? [{ key: "amount", label: "Amount", type: "number" as const, sortable: true, filterable: true, align: "right" as const }]
      : []),
    { key: "company", label: "Company", type: "text", sortable: true, filterable: true },
    { key: "owner", label: "Owner", type: "text", filterable: true },
    { key: "expectedOn", label: "Expected", type: "date", sortable: true, filterable: true },
    { key: "nextStep", label: "Next step", type: "text", filterable: true },
    { key: "closed", label: "Closed", type: "boolean", filterable: true, hiddenByDefault: true },
    { key: "score", label: "Score", type: "number", sortable: true, filterable: true, align: "right", hiddenByDefault: true },
    { key: "createdAt", label: "Added", type: "date", sortable: true, filterable: true, hiddenByDefault: true },
    ...custom.columns,
  ]);
  const query = (): QuerySpec => ({
    fields: {
      title: { path: ["title"], kind: "text", sortable: true, filterable: true },
      stage: { path: ["stageId"], kind: "string", filterable: true, ops: ["eq", "neq", "in"] },
      amount: { path: ["amountCents"], kind: "int", nullable: true, sortable: true, filterable: true },
      company: { path: ["company", "name"], kind: "text", nullable: true, sortable: true, filterable: true },
      owner: { path: ["ownerId"], kind: "string", nullable: true, filterable: true, ops: ["eq", "isnull"] },
      expectedOn: { path: ["expectedOn"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      nextStep: { path: ["nextStep"], kind: "text", nullable: true, filterable: true, ops: ["contains", "isnull"] },
      closed: {
        path: ["closedAt"],
        kind: "boolean",
        filterable: true,
        ops: ["eq"],
        where: (_op, v) => ({ closedAt: v === true ? { not: null } : null }),
      },
      createdAt: { path: ["createdAt"], kind: "datetime", sortable: true, filterable: true },
      score: { path: ["score"], kind: "int", sortable: true, filterable: true },
      ...custom.specs,
    },
    search: ["title", "nextStep"],
    searchExtra: (q) => [{ company: { name: { contains: q, mode: "insensitive" } } }],
    dateField: "createdAt",
    defaultSort: { col: "createdAt", dir: "desc" },
    tiebreak: (dir) => [{ id: dir }],
  });
  return {
    kind: DatabaseKind.CRM_PIPELINE,
    columns,
    query,
    baseWhere: (ctx) => ({ organizationId: ctx.organizationId, pipelineId: pipeline.id, deletedAt: null }),
    async list(db, args, ctx) {
      const rows = await db.crmDeal.findMany({
        where: args.where as Prisma.CrmDealWhereInput,
        orderBy: args.orderBy as Prisma.CrmDealOrderByWithRelationInput[],
        skip: args.skip,
        take: args.take,
        ...(args.cursor ? { cursor: args.cursor as Prisma.CrmDealWhereUniqueInput, skip: 1 } : {}),
        select: {
          id: true,
          title: true,
          stageId: true,
          amountCents: true,
          currency: true,
          ownerId: true,
          expectedOn: true,
          nextStep: true,
          closedAt: true,
          createdAt: true,
          score: true,
          custom: true,
          company: { select: { name: true } },
        },
      });
      const names = await memberNames(db, ctx.organizationId);
      const labels = await relationLabels(db, ctx.organizationId, fields, rows);
      return rows.map((d): MappedRow => {
        const values = (d.custom ?? {}) as Record<string, unknown>;
        return {
          id: d.id,
          cursor: { id: d.id },
          cells: {
            title: { t: "link", href: crmRecordHref(ctx.orgSlug, "deal", d.id), label: d.title },
            stage: { t: "badge", v: stageName.get(d.stageId) ?? "", tone: d.closedAt ? "outline" : "secondary" },
            amount: { t: "number", v: d.amountCents === null ? null : d.amountCents / 100, text: formatMoney(d.amountCents, d.currency) },
            company: text(d.company?.name ?? null),
            owner: text(owner(names, d.ownerId) || null),
            expectedOn: dateCell(d.expectedOn, ctx.timezone),
            nextStep: text(d.nextStep, { muted: !d.nextStep }),
            closed: { t: "bool", v: d.closedAt !== null },
            score: num(d.score),
            createdAt: dateCell(d.createdAt, ctx.timezone),
            ...Object.fromEntries(fields.map((f) => [customKey(f.id), customCell(f, values[f.id], names, labels)])),
          },
          csv: {
            title: d.title,
            stage: stageName.get(d.stageId) ?? "",
            amount: d.amountCents === null ? null : d.amountCents / 100,
            company: d.company?.name ?? null,
            owner: owner(names, d.ownerId),
            expectedOn: csvDate(d.expectedOn, ctx.timezone),
            nextStep: d.nextStep,
            closed: d.closedAt !== null,
            score: d.score,
            createdAt: csvDate(d.createdAt, ctx.timezone),
            ...Object.fromEntries(fields.map((f) => [customKey(f.id), customCsv(f, values[f.id], names, labels)])),
          },
        };
      });
    },
    count: (db, where) => db.crmDeal.count({ where: where as Prisma.CrmDealWhereInput }),
  };
}
