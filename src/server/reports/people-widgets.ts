import { Prisma } from "@/generated/prisma/client";
import type {
  JourneyPayload,
  ReachPayload,
  RegularsPayload,
  StoppedPayload,
  WhenPayload,
} from "@/lib/reports/compute";
import type { TxClient } from "@/server/db/context";

import { inRange, localDateText, localTime, num } from "./sql";

/**
 * The optional people widgets of a saved report (Events and attendance,
 * People): from signup to regular, who you reach, when people come,
 * regulars and who stopped coming. They read Signups, Attendance and People
 * in the VIEWER's transaction, so the database visibility in Privacy
 * decides what each person sees, as it does in Databases. Regulars and
 * Stopped coming name people, so the catalog offers them to owners and
 * admins only.
 */

export interface PeopleArgs {
  orgId: string;
  from: string | null;
  to: string | null;
  tz: string;
}

/** Checked-in, not suppressed, at a live event. */
function checkIns(args: PeopleArgs): Prisma.Sql {
  return Prisma.sql`
    SELECT a."contactId" AS contact_id, a."checkedInAt" AS at, e."id" AS event_id, e."startsAt" AS starts_at
      FROM public."Attendance" a
      JOIN public."Event" e ON e."organizationId" = a."organizationId" AND e."id" = a."eventId"
     WHERE a."organizationId" = ${args.orgId}
       AND a."suppressedAt" IS NULL
       AND e."deletedAt" IS NULL
       AND e."mergedIntoId" IS NULL
       AND ${inRange(Prisma.sql`e."startsAt"`, args.from, args.to, args.tz)}`;
}

/** People who signed up in the span, and how far they got: once, twice, three or more. */
export async function queryJourney(db: TxClient, args: PeopleArgs): Promise<JourneyPayload> {
  const rows = await db.$queryRaw<
    { signed: unknown; once: unknown; twice: unknown; regular: unknown }[]
  >`
    SELECT count(DISTINCT s."contactId") AS signed,
           count(DISTINCT s."contactId") FILTER (WHERE c."sessionsAttended" >= 1) AS once,
           count(DISTINCT s."contactId") FILTER (WHERE c."sessionsAttended" >= 2) AS twice,
           count(DISTINCT s."contactId") FILTER (WHERE c."sessionsAttended" >= 3) AS regular
      FROM public."Signup" s
      JOIN public."Contact" c ON c."organizationId" = s."organizationId" AND c."id" = s."contactId"
     WHERE s."organizationId" = ${args.orgId}
       AND s."suppressedAt" IS NULL
       AND ${inRange(Prisma.sql`s."signedUpAt"`, args.from, args.to, args.tz)}`;
  const r = rows[0];
  return {
    steps: [
      { label: "Signed up", count: num(r?.signed) },
      { label: "Came once", count: num(r?.once) },
      { label: "Came twice", count: num(r?.twice) },
      { label: "Regular (3 or more)", count: num(r?.regular) },
    ],
  };
}

/** Who came in the span by class year (from their signup), against everyone who signed up. */
export async function queryReach(db: TxClient, args: PeopleArgs): Promise<ReachPayload> {
  const rows = await db.$queryRaw<{ label: string | null; came: unknown; signed: unknown }[]>`
    WITH years AS (
      SELECT DISTINCT ON (s."contactId") s."contactId" AS contact_id, nullif(trim(s."classYear"), '') AS label
        FROM public."Signup" s
       WHERE s."organizationId" = ${args.orgId} AND s."suppressedAt" IS NULL
       ORDER BY s."contactId", s."signedUpAt" DESC
    ),
    came AS (SELECT DISTINCT contact_id FROM (${checkIns(args)}) x)
    SELECT y.label,
           count(*) FILTER (WHERE c.contact_id IS NOT NULL) AS came,
           count(*) AS signed
      FROM years y
      LEFT JOIN came c ON c.contact_id = y.contact_id
     GROUP BY y.label
     ORDER BY y.label NULLS LAST
     LIMIT 12`;
  const out = rows.map((r) => ({
    label: r.label ?? "Not given",
    came: num(r.came),
    signedUp: num(r.signed),
  }));
  return { rows: out, attendees: out.reduce((a, b) => a + b.came, 0) };
}

const SLOTS = ["morning", "afternoon", "evening"] as const;

/** Average check-ins an event by the weekday and part of day it started. */
export async function queryWhen(db: TxClient, args: PeopleArgs): Promise<WhenPayload> {
  const rows = await db.$queryRaw<
    { dow: unknown; slot: string; events: unknown; checkins: unknown }[]
  >`
    WITH ev AS (
      SELECT event_id, starts_at, count(*) AS n FROM (${checkIns(args)}) x GROUP BY event_id, starts_at
    )
    SELECT (extract(isodow FROM ${localTime(Prisma.sql`starts_at`, args.tz)})::int - 1) AS dow,
           CASE WHEN extract(hour FROM ${localTime(Prisma.sql`starts_at`, args.tz)}) < 12 THEN 'morning'
                WHEN extract(hour FROM ${localTime(Prisma.sql`starts_at`, args.tz)}) < 17 THEN 'afternoon'
                ELSE 'evening' END AS slot,
           count(*) AS events,
           sum(n) AS checkins
      FROM ev
     GROUP BY 1, 2`;
  const cells = rows.map((r) => {
    const events = num(r.events);
    return {
      weekday: num(r.dow),
      slot: (SLOTS as readonly string[]).includes(r.slot)
        ? (r.slot as (typeof SLOTS)[number])
        : "evening",
      events,
      average: events ? Math.round((num(r.checkins) / events) * 10) / 10 : 0,
    };
  });
  const best =
    [...cells].filter((c) => c.events > 0).sort((a, b) => b.average - a.average)[0] ?? null;
  return { cells, best };
}

/** Who came most in the span. */
export async function queryRegulars(db: TxClient, args: PeopleArgs): Promise<RegularsPayload> {
  const rows = await db.$queryRaw<{ id: string; name: string | null; n: unknown; last: string }[]>`
    SELECT c."id", c."displayName" AS name, count(*) AS n,
           ${localDateText(Prisma.sql`max(x.at)`, args.tz)} AS last
      FROM (${checkIns(args)}) x
      JOIN public."Contact" c ON c."organizationId" = ${args.orgId} AND c."id" = x.contact_id
     GROUP BY c."id", c."displayName"
     ORDER BY n DESC, last DESC
     LIMIT 10`;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name ?? "Someone",
      checkIns: num(r.n),
      lastDate: r.last,
    })),
  };
}

/**
 * People who came often (three or more times) and then stopped: missed the
 * organization's last sessions, as the lapsed job decides (lapsedSince),
 * newest first, with an address to invite them back where the viewer may
 * read it.
 */
export async function queryStopped(db: TxClient, args: PeopleArgs): Promise<StoppedPayload> {
  const rows = await db.$queryRaw<
    { id: string; name: string | null; n: unknown; last: string | null; email: string | null }[]
  >`
    SELECT c."id", c."displayName" AS name, c."sessionsAttended" AS n,
           ${localDateText(Prisma.sql`c."lastCheckInAt"`, args.tz)} AS last,
           (SELECT ce."emailNormalized" FROM public."ContactEmail" ce
             WHERE ce."organizationId" = c."organizationId" AND ce."contactId" = c."id"
             ORDER BY ce."isPrimary" DESC, ce."createdAt" LIMIT 1) AS email
      FROM public."Contact" c
     WHERE c."organizationId" = ${args.orgId}
       AND c."lapsedSince" IS NOT NULL
       AND c."sessionsAttended" >= 3
       AND c."unsubscribedAt" IS NULL
     ORDER BY c."lapsedSince" DESC
     LIMIT 50`;
  return {
    rows: rows.slice(0, 10).map((r) => ({
      id: r.id,
      name: r.name ?? "Someone",
      sessions: num(r.n),
      lastDate: r.last,
    })),
    total: rows.length,
    emails: rows.map((r) => r.email).filter((e): e is string => Boolean(e)),
  };
}
