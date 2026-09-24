import { defineColumns } from "@/components/databases/column-config";
import { DatabaseKind, RecordSource, SignupSource, SignupStatus, type Prisma } from "@/generated/prisma/client";
import { SIGNUP_LABELS, signupLabel } from "@/server/sync/supabase-map";

import {
  CHANNEL_LABELS,
  contactName,
  csvDateTime,
  dateCell,
  dateTimeCell,
  num,
  options,
  personCell,
  SOURCE_LABELS,
  STATUS_LABELS,
  termLabel,
  text,
  visibleEmail,
} from "../format";
import type { QuerySpec } from "../query-builder";
import type { DatabaseSource, MappedRow, ViewContext } from "../types";
import { CONTACT_ALIASES, contactFields, contactSearch, contactSelect } from "./shared";

/**
 * Signups (Phase 4b): the interest form, one row per person per term.
 * Member info (name, email for authorized tiers, year, colleges, days,
 * interests), source (channel), signup date and status. Visible to OWNER/
 * ADMIN by default (Settings > Privacy); RLS enforces it on every path.
 */

const YEAR_OPTIONS = options(SIGNUP_LABELS.classYear);

export const signupColumns = defineColumns([
  { key: "person", label: "Name", type: "person", sortable: true, filterable: true, searchable: true },
  { key: "email", label: "Email", type: "email", pii: true },
  { key: "classYear", label: "Year", type: "select", sortable: true, filterable: true, options: YEAR_OPTIONS },
  { key: "colleges", label: "Colleges", type: "multiselect", filterable: true, options: options(SIGNUP_LABELS.colleges) },
  { key: "meetDays", label: "Meet days", type: "multiselect", filterable: true, hiddenByDefault: true, options: options(SIGNUP_LABELS.meet_days) },
  { key: "interests", label: "Interests", type: "multiselect", filterable: true, options: options(SIGNUP_LABELS.interests) },
  { key: "channel", label: "Source", type: "select", sortable: true, filterable: true, options: options(CHANNEL_LABELS) },
  { key: "signedUpAt", label: "Signup date", type: "datetime", sortable: true, filterable: true },
  { key: "status", label: "Status", type: "select", sortable: true, filterable: true, options: options(STATUS_LABELS) },
  { key: "firstAttendedAt", label: "First attended", type: "date", sortable: true, filterable: true },
  { key: "daysToFirstAttendance", label: "Days to first visit", type: "number", sortable: true, filterable: true, align: "right", hiddenByDefault: true },
  { key: "addedToListAt", label: "Added to list", type: "date", sortable: true, filterable: true, hiddenByDefault: true },
  { key: "submissions", label: "Submissions", type: "number", sortable: true, filterable: true, align: "right", hiddenByDefault: true },
  { key: "term", label: "Term", type: "text", sortable: true, filterable: true },
  { key: "recordSource", label: "Record source", type: "select", filterable: true, hiddenByDefault: true, options: options(SOURCE_LABELS) },
  { key: "suppressed", label: "Suppressed", type: "boolean", filterable: true, hiddenByDefault: true },
  { key: "suppressedAt", label: "Suppressed at", type: "datetime", filterable: true, hiddenByDefault: true },
]);

function querySpec(): QuerySpec {
  return {
    fields: {
      id: { path: ["id"], kind: "string", filterable: true, ops: ["eq", "in"] },
      ...contactFields(["contact"]),
      classYear: { path: ["classYear"], kind: "string", nullable: true, sortable: true, filterable: true },
      colleges: { path: ["answers"], jsonPath: ["colleges"], kind: "jsonArray", filterable: true },
      meetDays: { path: ["answers"], jsonPath: ["meet_days"], kind: "jsonArray", filterable: true },
      interests: { path: ["answers"], jsonPath: ["interests"], kind: "jsonArray", filterable: true },
      channel: { path: ["channel"], kind: "enum", enumValues: Object.values(SignupSource), sortable: true, filterable: true },
      signedUpAt: { path: ["signedUpAt"], kind: "datetime", sortable: true, filterable: true },
      status: { path: ["status"], kind: "enum", enumValues: Object.values(SignupStatus), sortable: true, filterable: true },
      firstAttendedAt: { path: ["firstAttendedAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      daysToFirstAttendance: { path: ["daysToFirstAttendance"], kind: "int", nullable: true, sortable: true, filterable: true },
      addedToListAt: { path: ["addedToListAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      submissions: { path: ["submissions"], kind: "int", sortable: true, filterable: true },
      term: { path: ["term"], kind: "string", nullable: true, sortable: true, filterable: true },
      recordSource: { path: ["recordSource"], kind: "enum", enumValues: Object.values(RecordSource), filterable: true },
      suppressed: {
        path: ["suppressedAt"],
        kind: "boolean",
        filterable: true,
        ops: ["eq"],
        where: (_op, v) => ({ suppressedAt: v === true ? { not: null } : null }),
      },
      suppressedAt: { path: ["suppressedAt"], kind: "datetime", nullable: true, filterable: true },
    },
    aliases: {
      ...CONTACT_ALIASES,
      source: "channel",
      date: "signedUpAt",
      signupDate: "signedUpAt",
      year: "classYear",
      meet_days: "meetDays",
      converted: "firstAttendedAt",
    },
    search: ["classYear"],
    searchExtra: (q) => contactSearch(["contact"], q),
    dateField: "signedUpAt",
    defaultSort: { col: "signedUpAt", dir: "desc" },
    tiebreak: (dir) => [{ id: dir }],
    defaultFilters: [{ col: "suppressedAt", op: "isnull", value: "true", skipIf: ["suppressed"] }],
  };
}

const select = {
  id: true,
  term: true,
  channel: true,
  classYear: true,
  signedUpAt: true,
  submissions: true,
  addedToListAt: true,
  answers: true,
  suppressedAt: true,
  recordSource: true,
  status: true,
  firstAttendedAt: true,
  daysToFirstAttendance: true,
  contact: { select: contactSelect },
} satisfies Prisma.SignupSelect;

type Row = Prisma.SignupGetPayload<{ select: typeof select }>;

function list(answers: unknown, key: "colleges" | "meet_days" | "interests"): string[] {
  const v = answers && typeof answers === "object" ? (answers as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "warning"> = {
  PENDING: "outline",
  ADDED: "default",
  UNSUBSCRIBED: "warning",
};

function map(s: Row, ctx: ViewContext): MappedRow {
  const colleges = list(s.answers, "colleges").map((v) => signupLabel("colleges", v));
  const days = list(s.answers, "meet_days").map((v) => signupLabel("meet_days", v));
  const interests = list(s.answers, "interests").map((v) => signupLabel("interests", v));
  const email = visibleEmail(s.contact);
  const year = s.classYear ? signupLabel("classYear", s.classYear) : "";
  return {
    id: s.id,
    cursor: { id: s.id },
    dim: s.suppressedAt !== null,
    cells: {
      person: personCell(s.contact),
      email: text(email, { muted: !s.contact.emails?.length }),
      classYear: text(year),
      colleges: { t: "badges", v: colleges },
      meetDays: { t: "badges", v: days },
      interests: { t: "badges", v: interests },
      channel: { t: "badge", v: CHANNEL_LABELS[s.channel] ?? s.channel, tone: "outline" },
      signedUpAt: dateTimeCell(s.signedUpAt, ctx.timezone),
      status: { t: "badge", v: STATUS_LABELS[s.status] ?? s.status, tone: STATUS_TONE[s.status] ?? "outline" },
      firstAttendedAt: dateCell(s.firstAttendedAt, ctx.timezone),
      daysToFirstAttendance: num(s.daysToFirstAttendance),
      addedToListAt: dateCell(s.addedToListAt, ctx.timezone),
      submissions: num(s.submissions),
      term: text(termLabel(s.term)),
      recordSource: { t: "badge", v: SOURCE_LABELS[s.recordSource] ?? s.recordSource, tone: "secondary" },
      suppressed: s.suppressedAt ? { t: "badge", v: "Suppressed", tone: "warning" } : { t: "bool", v: false },
      suppressedAt: dateTimeCell(s.suppressedAt, ctx.timezone),
    },
    csv: {
      person: contactName(s.contact),
      email,
      classYear: year,
      colleges: colleges.join("; "),
      meetDays: days.join("; "),
      interests: interests.join("; "),
      channel: CHANNEL_LABELS[s.channel] ?? s.channel,
      signedUpAt: csvDateTime(s.signedUpAt, ctx.timezone),
      status: STATUS_LABELS[s.status] ?? s.status,
      firstAttendedAt: csvDateTime(s.firstAttendedAt, ctx.timezone),
      daysToFirstAttendance: s.daysToFirstAttendance,
      addedToListAt: csvDateTime(s.addedToListAt, ctx.timezone),
      submissions: s.submissions,
      term: s.term,
      recordSource: SOURCE_LABELS[s.recordSource] ?? s.recordSource,
      suppressed: s.suppressedAt !== null,
      suppressedAt: csvDateTime(s.suppressedAt, ctx.timezone),
    },
  };
}

export const signupsSource: DatabaseSource = {
  kind: DatabaseKind.SIGNUPS,
  columns: signupColumns,
  query: querySpec,
  baseWhere: (ctx) => ({ organizationId: ctx.organizationId }),
  async list(db, args, ctx) {
    const rows = await db.signup.findMany({
      where: args.where as Prisma.SignupWhereInput,
      orderBy: args.orderBy as Prisma.SignupOrderByWithRelationInput[],
      skip: args.skip,
      take: args.take,
      ...(args.cursor ? { cursor: args.cursor as Prisma.SignupWhereUniqueInput, skip: 1 } : {}),
      select,
    });
    return rows.map((r) => map(r, ctx));
  },
  count: (db, where) => db.signup.count({ where: where as Prisma.SignupWhereInput }),
  csvHeader: (c, ctx) =>
    c.type === "datetime" || c.type === "date" ? `${c.label} (${ctx.timezone})` : c.label,
};
