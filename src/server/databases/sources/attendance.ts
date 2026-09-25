import { defineColumns } from "@/components/databases/column-config";
import { AttendanceMethod, DatabaseKind, RecordSource, type Prisma } from "@/generated/prisma/client";

import {
  contactName,
  csvDateTime,
  dateTimeCell,
  fmtDate,
  METHOD_LABELS,
  num,
  options,
  personCell,
  SOURCE_LABELS,
  termLabel,
  text,
  visibleEmail,
} from "../format";
import type { QuerySpec } from "../query-builder";
import type { DatabaseSource, MappedRow, ViewContext } from "../types";
import { CONTACT_ALIASES, contactFields, contactSearch, contactSelect } from "./shared";

/**
 * Attendance (Phase 4b): one row per check-in. 'Stamp #' is which stamp the
 * check-in earned in its term and 'Term stamps' the person's total for the
 * term: rollup columns maintained by app.refresh_contact_rollups, so both
 * sort and filter server-side on indexed columns.
 */

export const attendanceColumns = defineColumns([
  { key: "person", label: "Member", type: "person", sortable: true, filterable: true, searchable: true },
  { key: "email", label: "Email", type: "email", pii: true, hiddenByDefault: true },
  { key: "session", label: "Session", type: "relation", target: "sessions", sortable: true, filterable: true },
  { key: "checkedInAt", label: "Check-in time", type: "datetime", sortable: true, filterable: true },
  { key: "method", label: "Method", type: "select", sortable: true, filterable: true, options: options(METHOD_LABELS) },
  { key: "stampNumber", label: "Stamp #", type: "number", sortable: true, filterable: true, align: "right" },
  { key: "termStampTotal", label: "Term stamps", type: "number", sortable: true, filterable: true, align: "right" },
  { key: "isFirstVisit", label: "First visit", type: "boolean", sortable: true, filterable: true },
  { key: "term", label: "Term", type: "text", sortable: true, filterable: true },
  { key: "source", label: "Source", type: "select", filterable: true, hiddenByDefault: true, options: options(SOURCE_LABELS) },
  { key: "suppressed", label: "Suppressed", type: "boolean", filterable: true, hiddenByDefault: true },
  { key: "suppressedAt", label: "Suppressed at", type: "datetime", filterable: true, hiddenByDefault: true },
  { key: "nameAsEntered", label: "Name as entered", type: "text", filterable: true, hiddenByDefault: true, pii: true },
]);

function querySpec(): QuerySpec {
  return {
    fields: {
      id: { path: ["id"], kind: "string", filterable: true, ops: ["eq", "in"] },
      ...contactFields(["contact"]),
      session: { path: ["eventId"], kind: "string", filterable: true, ops: ["eq", "in"], orderBy: (dir) => [{ event: { startsAt: dir } }], sortable: true },
      sessionDate: { path: ["event", "startsAt"], kind: "datetime", sortable: true, filterable: true },
      sessionKind: { path: ["event", "kind"], kind: "enum", enumValues: ["WORKSHOP", "SOCIAL", "HACKATHON", "INFO_SESSION", "BOARD_MEETING", "OTHER"], filterable: true },
      checkedInAt: { path: ["checkedInAt"], kind: "datetime", sortable: true, filterable: true },
      method: { path: ["method"], kind: "enum", enumValues: Object.values(AttendanceMethod), sortable: true, filterable: true },
      stampNumber: { path: ["stampNumber"], kind: "int", nullable: true, sortable: true, filterable: true },
      termStampTotal: { path: ["termStampTotal"], kind: "int", sortable: true, filterable: true },
      isFirstVisit: { path: ["isFirstVisit"], kind: "boolean", sortable: true, filterable: true },
      term: { path: ["term"], kind: "string", sortable: true, filterable: true },
      source: { path: ["source"], kind: "enum", enumValues: Object.values(RecordSource), filterable: true },
      suppressed: {
        path: ["suppressedAt"],
        kind: "boolean",
        filterable: true,
        ops: ["eq"],
        where: (_op, v) => ({ suppressedAt: v === true ? { not: null } : null }),
      },
      suppressedAt: { path: ["suppressedAt"], kind: "datetime", nullable: true, filterable: true },
      nameAsEntered: { path: ["nameAsEntered"], kind: "text", nullable: true, filterable: true },
    },
    aliases: {
      ...CONTACT_ALIASES,
      eventId: "session",
      event: "session",
      stamp: "stampNumber",
      stamps: "termStampTotal",
      firstVisit: "isFirstVisit",
      date: "checkedInAt",
    },
    search: ["nameAsEntered"],
    searchExtra: (q) => [
      ...contactSearch(["contact"], q),
      { nameOverride: { contains: q, mode: "insensitive" } },
      { event: { title: { contains: q, mode: "insensitive" } } },
    ],
    dateField: "checkedInAt",
    defaultSort: { col: "checkedInAt", dir: "desc" },
    tiebreak: (dir) => [{ id: dir }],
    // Suppressed check-ins are hidden unless the view asks about suppression.
    defaultFilters: [{ col: "suppressedAt", op: "isnull", value: "true", skipIf: ["suppressed"] }],
  };
}

const select = {
  id: true,
  checkedInAt: true,
  method: true,
  stampNumber: true,
  termStampTotal: true,
  isFirstVisit: true,
  term: true,
  source: true,
  suppressedAt: true,
  nameAsEntered: true,
  nameOverride: true,
  event: { select: { id: true, title: true, startsAt: true } },
  contact: { select: contactSelect },
} satisfies Prisma.AttendanceSelect;

type Row = Prisma.AttendanceGetPayload<{ select: typeof select }>;

function map(a: Row, ctx: ViewContext): MappedRow {
  const sessionHref = `/app/${ctx.orgSlug}/databases/sessions?row=${encodeURIComponent(a.event.id)}`;
  const email = visibleEmail(a.contact);
  return {
    id: a.id,
    cursor: { id: a.id },
    dim: a.suppressedAt !== null,
    cells: {
      person: personCell(a.contact, a.nameOverride),
      email: text(email, { muted: !a.contact.emails?.length }),
      session: {
        t: "link",
        href: sessionHref,
        label: `${a.event.title} · ${fmtDate(a.event.startsAt, ctx.timezone)}`,
      },
      checkedInAt: dateTimeCell(a.checkedInAt, ctx.timezone),
      method: { t: "badge", v: METHOD_LABELS[a.method] ?? a.method, tone: "outline" },
      stampNumber: num(a.stampNumber),
      termStampTotal: num(a.termStampTotal),
      isFirstVisit: { t: "bool", v: a.isFirstVisit },
      term: text(termLabel(a.term)),
      source: { t: "badge", v: SOURCE_LABELS[a.source] ?? a.source, tone: "secondary" },
      suppressed: a.suppressedAt ? { t: "badge", v: "Suppressed", tone: "warning" } : { t: "bool", v: false },
      suppressedAt: dateTimeCell(a.suppressedAt, ctx.timezone),
      nameAsEntered: text(a.nameAsEntered),
    },
    csv: {
      person: contactName(a.contact, a.nameOverride),
      email,
      session: `${a.event.title} (${fmtDate(a.event.startsAt, ctx.timezone)})`,
      checkedInAt: csvDateTime(a.checkedInAt, ctx.timezone),
      method: METHOD_LABELS[a.method] ?? a.method,
      stampNumber: a.stampNumber,
      termStampTotal: a.termStampTotal,
      isFirstVisit: a.isFirstVisit,
      term: a.term,
      source: SOURCE_LABELS[a.source] ?? a.source,
      suppressed: a.suppressedAt !== null,
      suppressedAt: csvDateTime(a.suppressedAt, ctx.timezone),
      nameAsEntered: a.nameAsEntered,
    },
  };
}

export const attendanceSource: DatabaseSource = {
  kind: DatabaseKind.ATTENDANCE,
  columns: attendanceColumns,
  query: querySpec,
  baseWhere: (ctx) => ({ organizationId: ctx.organizationId }),
  async list(db, args, ctx) {
    const rows = await db.attendance.findMany({
      where: args.where as Prisma.AttendanceWhereInput,
      orderBy: args.orderBy as Prisma.AttendanceOrderByWithRelationInput[],
      skip: args.skip,
      take: args.take,
      ...(args.cursor ? { cursor: args.cursor as Prisma.AttendanceWhereUniqueInput, skip: 1 } : {}),
      select,
    });
    return rows.map((r) => map(r, ctx));
  },
  count: (db, where) => db.attendance.count({ where: where as Prisma.AttendanceWhereInput }),
  csvHeader: (c, ctx) => (c.type === "datetime" ? `${c.label} (${ctx.timezone})` : c.label),
};
