import { defineColumns } from "@/components/databases/column-config";
import { DatabaseKind, type Prisma } from "@/generated/prisma/client";

import {
  contactName,
  csvDate,
  csvDateTime,
  dateCell,
  dateTimeCell,
  num,
  personCell,
  termLabel,
  termOf,
  text,
  visibleEmail,
} from "../format";
import type { QuerySpec } from "../query-builder";
import type { DatabaseSource, MappedRow, ViewContext } from "../types";
import { CONTACT_ALIASES, contactFields, contactSearch, contactSelect } from "./shared";

/**
 * People (Phase 4b): read-only, one row per person per term, from
 * ContactTermStats (maintained by app.refresh_contact_rollups) joined to
 * the Contact (lapsedSince from app.refresh_lapsed). The term filter
 * defaults to the current term; nd=term (the "All terms" choice) turns the
 * default off.
 */

export const peopleColumns = defineColumns([
  { key: "person", label: "Person", type: "person", sortable: true, filterable: true, searchable: true },
  { key: "email", label: "Email", type: "email", pii: true, hiddenByDefault: true },
  { key: "term", label: "Term", type: "text", sortable: true, filterable: true },
  { key: "sessionsAttended", label: "Sessions", type: "number", sortable: true, filterable: true, align: "right" },
  { key: "stampCount", label: "Stamps", type: "number", sortable: true, filterable: true, align: "right" },
  { key: "firstCheckInAt", label: "First check-in", type: "datetime", sortable: true, filterable: true },
  { key: "lastCheckInAt", label: "Last check-in", type: "datetime", sortable: true, filterable: true },
  { key: "lapsed", label: "Lapsed", type: "boolean", sortable: true, filterable: true },
  { key: "lapsedSince", label: "Lapsed since", type: "date", sortable: true, filterable: true, hiddenByDefault: true },
  { key: "allTimeSessions", label: "All-time sessions", type: "number", sortable: true, filterable: true, align: "right", hiddenByDefault: true },
  { key: "linked", label: "Member account", type: "boolean", filterable: true },
]);

function querySpec(ctx: ViewContext): QuerySpec {
  return {
    fields: {
      ...contactFields(["contact"]),
      term: { path: ["term"], kind: "string", sortable: true, filterable: true },
      sessionsAttended: { path: ["sessionsAttended"], kind: "int", sortable: true, filterable: true },
      stampCount: { path: ["stampCount"], kind: "int", sortable: true, filterable: true },
      firstCheckInAt: { path: ["firstCheckInAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      lastCheckInAt: { path: ["lastCheckInAt"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      lapsed: {
        path: ["contact", "lapsedSince"],
        kind: "boolean",
        sortable: true,
        filterable: true,
        ops: ["eq"],
        where: (_op, v) => ({ contact: { lapsedSince: v === true ? { not: null } : null } }),
        orderBy: (dir) => [{ contact: { lapsedSince: { sort: dir, nulls: dir === "asc" ? "first" : "last" } } }],
      },
      lapsedSince: { path: ["contact", "lapsedSince"], kind: "datetime", nullable: true, sortable: true, filterable: true },
      allTimeSessions: { path: ["contact", "sessionsAttended"], kind: "int", sortable: true, filterable: true },
    },
    aliases: {
      ...CONTACT_ALIASES,
      sessions: "sessionsAttended",
      stamps: "stampCount",
      firstVisit: "firstCheckInAt",
      lastVisit: "lastCheckInAt",
      stoppedAttending: "lapsed",
    },
    searchExtra: (q) => contactSearch(["contact"], q),
    dateField: "lastCheckInAt",
    defaultSort: { col: "stampCount", dir: "desc" },
    tiebreak: (dir) => [{ contactId: dir }, { term: dir }],
    // The current term, unless the URL states its own filters (report deep
    // links such as "stopped showing up" span terms).
    defaultFilters: [{ col: "term", op: "eq", value: termOf(ctx.now, ctx.timezone), onlyUnfiltered: true }],
  };
}

const select = {
  contactId: true,
  term: true,
  sessionsAttended: true,
  stampCount: true,
  firstCheckInAt: true,
  lastCheckInAt: true,
  contact: { select: { ...contactSelect, sessionsAttended: true } },
} satisfies Prisma.ContactTermStatsSelect;

type Row = Prisma.ContactTermStatsGetPayload<{ select: typeof select }>;

/** People rows are keyed contactId:term. */
export function peopleRowId(contactId: string, term: string): string {
  return `${contactId}:${term}`;
}

function map(p: Row, ctx: ViewContext): MappedRow {
  const email = visibleEmail(p.contact);
  const lapsedSince = p.contact.lapsedSince;
  return {
    id: peopleRowId(p.contactId, p.term),
    cursor: {
      organizationId_contactId_term: { organizationId: ctx.organizationId, contactId: p.contactId, term: p.term },
    },
    cells: {
      person: personCell(p.contact),
      email: text(email, { muted: !p.contact.emails?.length }),
      term: text(termLabel(p.term)),
      sessionsAttended: num(p.sessionsAttended),
      stampCount: num(p.stampCount),
      firstCheckInAt: dateTimeCell(p.firstCheckInAt, ctx.timezone),
      lastCheckInAt: dateTimeCell(p.lastCheckInAt, ctx.timezone),
      lapsed: lapsedSince ? { t: "badge", v: "Lapsed", tone: "warning" } : { t: "bool", v: false },
      lapsedSince: dateCell(lapsedSince, ctx.timezone),
      allTimeSessions: num(p.contact.sessionsAttended),
      linked: { t: "bool", v: p.contact.userId !== null },
    },
    csv: {
      person: contactName(p.contact),
      email,
      term: p.term,
      sessionsAttended: p.sessionsAttended,
      stampCount: p.stampCount,
      firstCheckInAt: csvDateTime(p.firstCheckInAt, ctx.timezone),
      lastCheckInAt: csvDateTime(p.lastCheckInAt, ctx.timezone),
      lapsed: lapsedSince !== null,
      lapsedSince: csvDate(lapsedSince, ctx.timezone),
      allTimeSessions: p.contact.sessionsAttended,
      linked: p.contact.userId !== null,
    },
  };
}

export const peopleSource: DatabaseSource = {
  kind: DatabaseKind.PEOPLE,
  columns: peopleColumns,
  query: querySpec,
  baseWhere: (ctx) => ({ organizationId: ctx.organizationId }),
  async list(db, args, ctx) {
    const rows = await db.contactTermStats.findMany({
      where: args.where as Prisma.ContactTermStatsWhereInput,
      orderBy: args.orderBy as Prisma.ContactTermStatsOrderByWithRelationInput[],
      skip: args.skip,
      take: args.take,
      ...(args.cursor ? { cursor: args.cursor as Prisma.ContactTermStatsWhereUniqueInput, skip: 1 } : {}),
      select,
    });
    return rows.map((r) => map(r, ctx));
  },
  count: (db, where) => db.contactTermStats.count({ where: where as Prisma.ContactTermStatsWhereInput }),
  csvHeader: (c, ctx) =>
    c.type === "datetime" || c.type === "date" ? `${c.label} (${ctx.timezone})` : c.label,
};
