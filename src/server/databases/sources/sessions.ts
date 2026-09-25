import { defineColumns } from "@/components/databases/column-config";
import { DatabaseKind, EventKind, EventVisibility, type Prisma } from "@/generated/prisma/client";
import { userPublicSelect } from "@/server/members";

import {
  csvDateTime,
  dateTimeCell,
  EVENT_KIND_LABELS,
  num,
  options,
  termLabel,
  text,
} from "../format";
import type { QuerySpec } from "../query-builder";
import type { DatabaseSource, MappedRow, ViewContext } from "../types";

/**
 * Sessions (Phase 4a): the Event rows. A Session here and an event on the
 * calendar are the same record; writes go through src/server/events/service.ts.
 */

const VISIBILITY_LABELS: Record<string, string> = { PUBLIC: "Public", INTERNAL: "Internal" };

export const sessionColumns = defineColumns([
  {
    key: "title",
    label: "Title",
    type: "text",
    sortable: true,
    filterable: true,
    searchable: true,
  },
  {
    key: "kind",
    label: "Type",
    type: "select",
    sortable: true,
    filterable: true,
    options: options(EVENT_KIND_LABELS),
  },
  { key: "startsAt", label: "Date", type: "datetime", sortable: true, filterable: true },
  {
    key: "location",
    label: "Location",
    type: "text",
    sortable: true,
    filterable: true,
    searchable: true,
  },
  { key: "host", label: "Host", type: "person", filterable: true },
  {
    key: "attendanceCount",
    label: "Attendance",
    type: "number",
    sortable: true,
    filterable: true,
    align: "right",
  },
  {
    key: "visibility",
    label: "Visibility",
    type: "select",
    sortable: true,
    filterable: true,
    options: options(VISIBILITY_LABELS),
  },
  { key: "term", label: "Term", type: "text", sortable: true, filterable: true },
  { key: "calendar", label: "Calendar event", type: "link", exportable: false },
  {
    key: "stampSlot",
    label: "Stamp slot",
    type: "number",
    sortable: true,
    filterable: true,
    hiddenByDefault: true,
    align: "right",
  },
  {
    key: "endsAt",
    label: "Ends",
    type: "datetime",
    sortable: true,
    filterable: true,
    hiddenByDefault: true,
  },
  {
    key: "linked",
    label: "Website session",
    type: "boolean",
    filterable: true,
    hiddenByDefault: true,
  },
  {
    key: "needsReview",
    label: "Needs review",
    type: "boolean",
    filterable: true,
    hiddenByDefault: true,
    memberVisible: false,
  },
  { key: "rsvpUrl", label: "RSVP link", type: "url", hiddenByDefault: true },
]);

const querySpec: QuerySpec = {
  fields: {
    id: { path: ["id"], kind: "string", filterable: true, ops: ["eq", "in"] },
    title: { path: ["title"], kind: "text", sortable: true, filterable: true },
    kind: {
      path: ["kind"],
      kind: "enum",
      enumValues: Object.values(EventKind),
      sortable: true,
      filterable: true,
    },
    startsAt: { path: ["startsAt"], kind: "datetime", sortable: true, filterable: true },
    endsAt: { path: ["endsAt"], kind: "datetime", sortable: true, filterable: true },
    location: {
      path: ["location"],
      kind: "text",
      nullable: true,
      sortable: true,
      filterable: true,
    },
    host: {
      path: ["hostUserId"],
      kind: "string",
      nullable: true,
      filterable: true,
      ops: ["eq", "in", "isnull"],
    },
    attendanceCount: { path: ["attendanceCount"], kind: "int", sortable: true, filterable: true },
    visibility: {
      path: ["visibility"],
      kind: "enum",
      enumValues: Object.values(EventVisibility),
      sortable: true,
      filterable: true,
    },
    term: { path: ["term"], kind: "string", nullable: true, sortable: true, filterable: true },
    stampSlot: {
      path: ["stampSlot"],
      kind: "int",
      nullable: true,
      sortable: true,
      filterable: true,
    },
    linked: {
      path: ["sourceSessionId"],
      kind: "boolean",
      filterable: true,
      ops: ["eq"],
      where: (_op, v) => ({ sourceSessionId: v === true ? { not: null } : null }),
    },
    needsReview: { path: ["needsReview"], kind: "boolean", filterable: true },
  },
  aliases: {
    date: "startsAt",
    type: "kind",
    hostUserId: "host",
    attendance: "attendanceCount",
    eventId: "id",
    session: "id",
  },
  search: ["title", "location"],
  dateField: "startsAt",
  defaultSort: { col: "startsAt", dir: "desc" },
  tiebreak: (dir) => [{ id: dir }],
};

const select = {
  id: true,
  title: true,
  kind: true,
  startsAt: true,
  endsAt: true,
  location: true,
  hostUserId: true,
  hostName: true,
  attendanceCount: true,
  visibility: true,
  term: true,
  stampSlot: true,
  sourceSessionId: true,
  needsReview: true,
  rsvpUrl: true,
  googleHtmlLink: true,
  host: { select: userPublicSelect },
} satisfies Prisma.EventSelect;

type Record_ = Prisma.EventGetPayload<{ select: typeof select }>;

function map(e: Record_, ctx: ViewContext): MappedRow {
  const calendarHref = `/app/${ctx.orgSlug}/calendar/${e.id}`;
  const hostName = e.host?.name ?? e.hostName ?? "";
  return {
    id: e.id,
    cursor: { id: e.id },
    cells: {
      title: text(e.title),
      kind: { t: "badge", v: EVENT_KIND_LABELS[e.kind] ?? e.kind, tone: "secondary" },
      startsAt: dateTimeCell(e.startsAt, ctx.timezone),
      endsAt: dateTimeCell(e.endsAt, ctx.timezone),
      location: text(e.location),
      host: e.host
        ? {
            t: "person",
            name: e.host.name ?? "Member",
            user: { name: e.host.name, image: e.host.image, avatar: e.host.avatar },
          }
        : e.hostName
          ? { t: "person", name: e.hostName, user: null, sub: "Guest" }
          : null,
      attendanceCount: num(e.attendanceCount),
      visibility: {
        t: "badge",
        v: VISIBILITY_LABELS[e.visibility] ?? e.visibility,
        tone: e.visibility === "PUBLIC" ? "default" : "outline",
      },
      term: text(termLabel(e.term)),
      stampSlot: num(e.stampSlot),
      calendar: e.googleHtmlLink
        ? { t: "link", href: e.googleHtmlLink, label: "Google Calendar", external: true }
        : { t: "link", href: calendarHref, label: "Open event" },
      linked: { t: "bool", v: e.sourceSessionId !== null },
      needsReview: e.needsReview ? { t: "badge", v: "Review", tone: "warning" } : null,
      rsvpUrl: e.rsvpUrl ? { t: "link", href: e.rsvpUrl, label: "RSVP", external: true } : null,
    },
    csv: {
      title: e.title,
      kind: EVENT_KIND_LABELS[e.kind] ?? e.kind,
      startsAt: csvDateTime(e.startsAt, ctx.timezone),
      endsAt: csvDateTime(e.endsAt, ctx.timezone),
      location: e.location,
      host: hostName,
      attendanceCount: e.attendanceCount,
      visibility: VISIBILITY_LABELS[e.visibility] ?? e.visibility,
      term: e.term,
      stampSlot: e.stampSlot,
      linked: e.sourceSessionId !== null,
      needsReview: e.needsReview,
      rsvpUrl: e.rsvpUrl,
    },
  };
}

export const sessionsSource: DatabaseSource = {
  kind: DatabaseKind.SESSIONS,
  columns: sessionColumns,
  query: () => querySpec,
  baseWhere: (ctx) => ({ organizationId: ctx.organizationId, deletedAt: null, mergedIntoId: null }),
  async list(db, args, ctx) {
    const rows = await db.event.findMany({
      where: args.where as Prisma.EventWhereInput,
      orderBy: args.orderBy as Prisma.EventOrderByWithRelationInput[],
      skip: args.skip,
      take: args.take,
      ...(args.cursor ? { cursor: args.cursor as Prisma.EventWhereUniqueInput, skip: 1 } : {}),
      select,
    });
    return rows.map((r) => map(r, ctx));
  },
  count: (db, where) => db.event.count({ where: where as Prisma.EventWhereInput }),
  csvHeader: (c, ctx) => (c.type === "datetime" ? `${c.label} (${ctx.timezone})` : c.label),
};
