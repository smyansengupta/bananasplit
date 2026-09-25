import { EventVisibility, Prisma, RecordSource } from "@/generated/prisma/client";
import { classifyBallot, isTestSlug, readDefinition } from "@/server/databases/ballot-definitions";
import { termOf } from "@/server/databases/format";
import type { SystemContext, TxClient } from "@/server/db/context";
import { findEventMatch } from "@/server/events/match";
import { createEvent, updateEvent } from "@/server/events/service";

import type { RemoteBallot, RemoteCheckin, RemoteSession, RemoteSignup, RemoteUnsubscribe } from "./remote";
import {
  cleanName,
  isSourceId,
  kindOfTitle,
  mapCheckinSource,
  mapSignupSource,
  maskEmail,
  normalizeEmail,
  signupAnswers,
} from "./supabase-map";

/**
 * The write side of the website sync: one short service-path transaction
 * per batch (the caller's withSystemOrgTx), no network I/O. Every write is
 * an idempotent upsert keyed on (organizationId, source, externalId), so a
 * replayed batch changes nothing.
 *
 * Suite-side decisions always win over the sync:
 * - suppressed rows stay suppressed; name overrides, "added to list" and
 *   contact names set in the suite are never overwritten;
 * - a session edited in the suite (suiteEditedAt) keeps its title, time and
 *   room; the sync only maintains its link, term and stamp slot;
 * - a check-in or signup that duplicates a suite row (same person, same
 *   session or term) is skipped, not doubled.
 */

export interface SyncScope {
  organizationId: string;
  timezone: string;
  /** Recorded as Event.createdById for sessions the sync creates. */
  creatorId: string;
  /** Verified emails of current members -> user id (for auto-linking contacts). */
  memberEmails: Map<string, string>;
}

export interface ApplyStats {
  upserted: number;
  skipped: number;
  /** Check-in sources outside code/link/officer (mapped to FORM). */
  unmapped?: number;
  contacts: string[];
  details?: Record<string, number>;
}

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Contacts ------------------------------------------------------------------

/**
 * Resolves addresses to contacts, creating the missing ones (masked address,
 * display name, first seen, and a link to the member whose verified email it
 * is). Existing contacts keep their name; an unnamed one takes the name
 * entered, and an unlinked one is linked when a member's verified email
 * matches.
 */
export async function resolveContacts(
  db: TxClient,
  scope: SyncScope,
  people: { email: string; name: string | null; at: Date }[],
): Promise<Map<string, string>> {
  const org = scope.organizationId;
  const byEmail = new Map<string, { name: string | null; at: Date }>();
  for (const p of people) {
    const prev = byEmail.get(p.email);
    if (!prev) byEmail.set(p.email, { name: p.name, at: p.at });
    else if (p.at < prev.at) byEmail.set(p.email, { name: prev.name ?? p.name, at: p.at });
  }
  const emails = [...byEmail.keys()];
  const found = new Map<string, string>();
  if (emails.length === 0) return found;

  const existing = await db.contactEmail.findMany({
    where: { organizationId: org, emailNormalized: { in: emails } },
    select: { emailNormalized: true, contact: { select: { id: true, displayName: true, userId: true } } },
  });
  for (const e of existing) {
    found.set(e.emailNormalized, e.contact.id);
    const seen = byEmail.get(e.emailNormalized);
    const patch: Prisma.ContactUpdateInput = {};
    if (!e.contact.displayName && seen?.name) patch.displayName = seen.name;
    const member = scope.memberEmails.get(e.emailNormalized);
    if (!e.contact.userId && member) patch.user = { connect: { id: member } };
    if (Object.keys(patch).length) await db.contact.update({ where: { id: e.contact.id }, data: patch });
  }

  const missing = emails.filter((e) => !found.has(e));
  if (missing.length) {
    const contacts: Prisma.ContactCreateManyInput[] = [];
    const contactEmails: Prisma.ContactEmailCreateManyInput[] = [];
    for (const email of missing) {
      const id = newId("ct_");
      const seen = byEmail.get(email);
      const masked = maskEmail(email);
      contacts.push({
        id,
        organizationId: org,
        displayName: seen?.name ?? null,
        emailMasked: masked.masked,
        emailDomain: masked.domain,
        userId: scope.memberEmails.get(email) ?? null,
        firstSeenAt: seen?.at ?? new Date(),
      });
      contactEmails.push({ id: newId("ce_"), organizationId: org, contactId: id, emailNormalized: email, isPrimary: true });
      found.set(email, id);
    }
    await db.contact.createMany({ data: contacts });
    await db.contactEmail.createMany({ data: contactEmails });
  }
  return found;
}

// ---- Sessions ------------------------------------------------------------------

export interface SessionStats {
  created: number;
  linked: number;
  updated: number;
  ambiguous: number;
  unlinked: number;
}

const DEFAULT_SESSION_MINUTES = 90;

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/**
 * Full refresh of the website's sessions: link each to its Event (exact
 * link, else the title-and-time match, else a new INTERNAL Event; several
 * candidates create a needsReview Event for the admin queue), apply the
 * precedence rule, and unlink and flag Events whose website session is gone.
 */
export async function applySessions(
  ctx: SystemContext & { organizationId: string },
  scope: SyncScope,
  sessions: RemoteSession[],
): Promise<SessionStats> {
  const db = ctx.db;
  const org = scope.organizationId;
  const stats: SessionStats = { created: 0, linked: 0, updated: 0, ambiguous: 0, unlinked: 0 };
  const svc = { db, organizationId: org, userId: scope.creatorId, role: null, kind: "system" as const };

  for (const s of sessions) {
    const startsAt = new Date(s.starts_at);
    const title = (cleanName(s.title) ?? "Session").slice(0, 200);
    const match = await findEventMatch(db, org, { source: "SUPABASE", externalId: s.id, title, startsAt }, scope.timezone);

    if (match.kind === "exact") {
      const event = await db.event.findFirst({
        where: { id: match.eventId, organizationId: org },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          location: true,
          term: true,
          stampSlot: true,
          suiteEditedAt: true,
          deletedAt: true,
        },
      });
      if (!event || event.deletedAt) continue;
      if (event.term !== s.term || event.stampSlot !== s.slot) {
        await db.event.update({ where: { id: event.id }, data: { term: s.term, stampSlot: s.slot } });
        stats.updated += 1;
      }
      if (!event.suiteEditedAt) {
        const room = s.room ? s.room.slice(0, 300) : null;
        if (event.title !== title || !sameInstant(event.startsAt, startsAt) || event.location !== room) {
          const duration = Math.max(event.endsAt.getTime() - event.startsAt.getTime(), 0);
          await updateEvent(
            svc,
            event.id,
            { title, startsAt, endsAt: new Date(startsAt.getTime() + duration), location: room },
            { origin: "sync" },
          );
          stats.updated += 1;
        }
      }
      continue;
    }

    if (match.kind === "matched") {
      await db.event.update({
        where: { id: match.eventId },
        data: { sourceSessionId: s.id, term: s.term, stampSlot: s.slot },
      });
      await db.eventLinkLog.create({
        data: { organizationId: org, eventId: match.eventId, source: "SUPABASE", externalId: s.id, method: "MATCHED", score: match.score },
      });
      stats.linked += 1;
      continue;
    }

    const { event } = await createEvent(
      svc,
      {
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + DEFAULT_SESSION_MINUTES * 60 * 1000),
        location: s.room,
        kind: kindOfTitle(title),
        visibility: EventVisibility.INTERNAL,
        term: /^(fall|spring)-\d{4}$/.test(s.term) ? s.term : null,
        stampSlot: s.slot >= 1 && s.slot <= 12 ? s.slot : null,
      },
      { origin: "sync" },
    );
    await db.event.update({
      where: { id: event.id },
      data: { sourceSessionId: s.id, needsReview: match.kind === "ambiguous" },
    });
    await db.eventLinkLog.create({
      data: { organizationId: org, eventId: event.id, source: "SUPABASE", externalId: s.id, method: "EXACT" },
    });
    if (match.kind === "ambiguous") stats.ambiguous += 1;
    else stats.created += 1;
  }

  // A website session that no longer exists: unlink and flag, never delete.
  // An empty list is treated as a read problem, not "everything was deleted".
  if (sessions.length > 0) {
    const ids = new Set(sessions.map((s) => s.id));
    const linked = await db.event.findMany({
      where: { organizationId: org, sourceSessionId: { not: null } },
      select: { id: true, sourceSessionId: true },
    });
    for (const e of linked) {
      if (e.sourceSessionId && !ids.has(e.sourceSessionId)) {
        await db.event.update({ where: { id: e.id }, data: { sourceSessionId: null, needsReview: true } });
        stats.unlinked += 1;
      }
    }
  }
  return stats;
}

/** The website session id -> Event id map for check-ins. */
export async function sessionEventMap(db: TxClient, organizationId: string, sessionIds: string[]) {
  const events = await db.event.findMany({
    where: { organizationId, sourceSessionId: { in: [...new Set(sessionIds)] } },
    select: { id: true, sourceSessionId: true, term: true },
  });
  return new Map(events.map((e) => [e.sourceSessionId as string, { id: e.id, term: e.term }]));
}

// ---- Check-ins -----------------------------------------------------------------

export async function applyCheckins(db: TxClient, scope: SyncScope, rows: RemoteCheckin[]): Promise<ApplyStats> {
  const org = scope.organizationId;
  const stats: ApplyStats = { upserted: 0, skipped: 0, unmapped: 0, contacts: [] };
  if (rows.length === 0) return stats;

  const events = await sessionEventMap(db, org, rows.map((r) => r.session_id));
  const people: { email: string; name: string | null; at: Date }[] = [];
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (email) people.push({ email, name: cleanName(r.name), at: new Date(r.created_at) });
  }
  const contacts = await resolveContacts(db, scope, people);

  const existing = new Map(
    (
      await db.attendance.findMany({
        where: { organizationId: org, source: RecordSource.SUPABASE_SYNC, externalId: { in: rows.map((r) => r.id) } },
        select: { id: true, externalId: true, contactId: true, eventId: true, method: true, checkedInAt: true, nameAsEntered: true },
      })
    ).map((a) => [a.externalId as string, a]),
  );

  const creates: Prisma.AttendanceCreateManyInput[] = [];
  const touched = new Set<string>();
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    const event = events.get(r.session_id);
    const contactId = email ? contacts.get(email) : undefined;
    if (!event || !contactId) {
      stats.skipped += 1;
      continue;
    }
    const { method, unmapped } = mapCheckinSource(r.source);
    if (unmapped) stats.unmapped = (stats.unmapped ?? 0) + 1;
    const checkedInAt = new Date(r.created_at);
    const name = cleanName(r.name);
    const prev = existing.get(r.id);
    if (!prev) {
      creates.push({
        id: newId("att_"),
        organizationId: org,
        eventId: event.id,
        contactId,
        term: event.term ?? termOf(checkedInAt, scope.timezone),
        checkedInAt,
        method,
        nameAsEntered: name,
        source: RecordSource.SUPABASE_SYNC,
        externalId: r.id,
      });
      touched.add(contactId);
      continue;
    }
    const patch: Prisma.AttendanceUncheckedUpdateInput = {};
    if (prev.method !== method) patch.method = method;
    if (!sameInstant(prev.checkedInAt, checkedInAt)) patch.checkedInAt = checkedInAt;
    if (prev.nameAsEntered !== name) patch.nameAsEntered = name;
    if (prev.contactId !== contactId) {
      // Re-attribution after a contact split: move only if it creates no duplicate.
      const clash = await db.attendance.count({ where: { organizationId: org, eventId: prev.eventId, contactId } });
      if (clash === 0) {
        patch.contactId = contactId;
        touched.add(prev.contactId);
      }
    }
    if (Object.keys(patch).length) {
      await db.attendance.update({ where: { id: prev.id }, data: patch });
      touched.add(contactId);
      stats.upserted += 1;
    }
  }
  if (creates.length) {
    const created = await db.attendance.createMany({ data: creates, skipDuplicates: true });
    stats.upserted += created.count;
    stats.skipped += creates.length - created.count;
  }
  stats.contacts = [...touched];
  return stats;
}

// ---- Signups -------------------------------------------------------------------

export async function applySignups(db: TxClient, scope: SyncScope, rows: RemoteSignup[]): Promise<ApplyStats> {
  const org = scope.organizationId;
  const stats: ApplyStats = { upserted: 0, skipped: 0, contacts: [] };
  if (rows.length === 0) return stats;
  const people: { email: string; name: string | null; at: Date }[] = [];
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (email) people.push({ email, name: cleanName(r.name), at: new Date(r.created_at) });
  }
  const contacts = await resolveContacts(db, scope, people);
  const existing = new Map(
    (
      await db.signup.findMany({
        where: { organizationId: org, recordSource: RecordSource.SUPABASE_SYNC, externalId: { in: rows.map((r) => r.id) } },
        select: { id: true, externalId: true, contactId: true, term: true, addedToListAt: true },
      })
    ).map((s) => [s.externalId as string, s]),
  );
  const touched = new Set<string>();
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    const contactId = email ? contacts.get(email) : undefined;
    if (!contactId) {
      stats.skipped += 1;
      continue;
    }
    const answers = signupAnswers(r) as unknown as Prisma.InputJsonValue;
    const common = {
      term: r.term,
      channel: mapSignupSource(r.source),
      classYear: r.class_year ? r.class_year.slice(0, 32) : null,
      sourceUpdatedAt: new Date(r.updated_at),
      submissions: Math.max(1, Number(r.submissions) || 1),
      answers,
    };
    const prev = existing.get(r.id);
    if (!prev) {
      const created = await db.signup.createMany({
        data: [
          {
            id: newId("sg_"),
            organizationId: org,
            contactId,
            signedUpAt: new Date(r.created_at),
            addedToListAt: r.added_to_list_at ? new Date(r.added_to_list_at) : null,
            externalId: r.id,
            recordSource: RecordSource.SUPABASE_SYNC,
            ...common,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count) {
        stats.upserted += 1;
        touched.add(contactId);
      } else stats.skipped += 1;
      continue;
    }
    const data: Prisma.SignupUncheckedUpdateInput = {
      ...common,
      addedToListAt: prev.addedToListAt ?? (r.added_to_list_at ? new Date(r.added_to_list_at) : null),
    };
    if (prev.contactId !== contactId) {
      const clash = await db.signup.count({ where: { organizationId: org, contactId, term: r.term } });
      if (clash === 0) {
        data.contactId = contactId;
        touched.add(prev.contactId);
      }
    }
    await db.signup.update({ where: { id: prev.id }, data });
    touched.add(contactId);
    stats.upserted += 1;
  }
  stats.contacts = [...touched];
  return stats;
}

// ---- Ballots -------------------------------------------------------------------

/**
 * Inserts ballots not seen before (ballots never change at the source).
 * Load-test and smoke-test slugs are not imported at all; everything else is
 * stored, linked to its definition by slug, classified (test poll, before or
 * after the window, retired options) and exploded into BallotChoice rows.
 */
export async function applyBallots(db: TxClient, scope: SyncScope, rows: RemoteBallot[]): Promise<ApplyStats> {
  const org = scope.organizationId;
  const stats: ApplyStats = { upserted: 0, skipped: 0, contacts: [], details: { testSlug: 0, excluded: 0 } };
  if (rows.length === 0) return stats;
  const known = new Set(
    (
      await db.ballot.findMany({
        where: { organizationId: org, source: RecordSource.SUPABASE_SYNC, externalId: { in: rows.map((r) => r.id) } },
        select: { externalId: true },
      })
    ).map((b) => b.externalId as string),
  );
  const fresh = rows.filter((r) => !known.has(r.id));
  const real = fresh.filter((r) => !isTestSlug(r.poll_slug));
  stats.details!.testSlug = fresh.length - real.length;
  stats.skipped = rows.length - real.length;
  if (real.length === 0) return stats;

  const defs = await db.ballotDefinition.findMany({
    where: { organizationId: org, slug: { in: [...new Set(real.map((r) => r.poll_slug))] } },
    select: { id: true, slug: true, isTest: true, opensAt: true, closesAt: true, definition: true },
  });
  const bySlug = new Map(defs.map((d) => [d.slug, { ...d, parsed: readDefinition(d.definition) }]));
  const creates: Prisma.BallotCreateManyInput[] = [];
  for (const r of real) {
    const def = bySlug.get(r.poll_slug) ?? null;
    const castAt = new Date(r.created_at);
    const answers = r.answers && typeof r.answers === "object" ? r.answers : {};
    const reason = classifyBallot(
      { pollSlug: r.poll_slug, castAt, answers },
      def ? { isTest: def.isTest, opensAt: def.opensAt, closesAt: def.closesAt, definition: def.parsed } : null,
    );
    if (reason) stats.details!.excluded += 1;
    creates.push({
      id: newId("bal_"),
      organizationId: org,
      ballotDefinitionId: def?.id ?? null,
      pollSlug: r.poll_slug.slice(0, 200),
      answers: answers as Prisma.InputJsonValue,
      castAt,
      source: RecordSource.SUPABASE_SYNC,
      externalId: r.id,
      excludedReason: reason,
    });
  }
  const created = await db.ballot.createMany({ data: creates, skipDuplicates: true });
  stats.upserted = created.count;
  const ids = await db.ballot.findMany({
    where: { organizationId: org, id: { in: creates.map((c) => c.id as string) } },
    select: { id: true },
  });
  for (const b of ids) await db.$queryRaw`SELECT app.explode_ballot(${org}, ${b.id}) AS n`;
  return stats;
}

// ---- Unsubscribes --------------------------------------------------------------

/**
 * Marks contacts whose address is on the website's unsubscribe list. Sticky:
 * the website has no "resubscribe" and the suite never clears it on its own.
 */
export async function applyUnsubscribes(db: TxClient, scope: SyncScope, rows: RemoteUnsubscribe[]): Promise<ApplyStats> {
  const org = scope.organizationId;
  const stats: ApplyStats = { upserted: 0, skipped: 0, contacts: [] };
  const byEmail = new Map<string, Date>();
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (email && !byEmail.has(email)) byEmail.set(email, new Date(r.created_at));
  }
  if (byEmail.size === 0) return stats;
  const matches = await db.contactEmail.findMany({
    where: { organizationId: org, emailNormalized: { in: [...byEmail.keys()] }, contact: { unsubscribedAt: null } },
    select: { emailNormalized: true, contactId: true },
  });
  for (const m of matches) {
    await db.contact.update({ where: { id: m.contactId }, data: { unsubscribedAt: byEmail.get(m.emailNormalized) } });
    stats.contacts.push(m.contactId);
    stats.upserted += 1;
  }
  stats.skipped = byEmail.size - matches.length;
  return stats;
}

// ---- Reconcile -----------------------------------------------------------------

/**
 * Removes synced rows whose website row no longer exists (an officer deleted
 * it, or the site erased a person). Called only after a complete pass over
 * the stream in the same run. Only rows whose externalId has the website's
 * id shape (a UUID) are candidates, so rows that arrived any other way are
 * never touched. Returns the contacts whose rollups need refreshing.
 */
export async function removeMissing(
  db: TxClient,
  organizationId: string,
  stream: "checkins" | "signups" | "ballots",
  seen: Set<string>,
): Promise<{ removed: number; contacts: string[] }> {
  const where = { organizationId, externalId: { not: null } };
  if (stream === "checkins") {
    const rows = await db.attendance.findMany({
      where: { ...where, source: RecordSource.SUPABASE_SYNC },
      select: { id: true, externalId: true, contactId: true },
    });
    const gone = rows.filter((r) => isSourceId(r.externalId) && !seen.has(r.externalId));
    if (gone.length) await db.attendance.deleteMany({ where: { organizationId, id: { in: gone.map((g) => g.id) } } });
    return { removed: gone.length, contacts: [...new Set(gone.map((g) => g.contactId))] };
  }
  if (stream === "signups") {
    const rows = await db.signup.findMany({
      where: { ...where, recordSource: RecordSource.SUPABASE_SYNC },
      select: { id: true, externalId: true, contactId: true },
    });
    const gone = rows.filter((r) => isSourceId(r.externalId) && !seen.has(r.externalId));
    if (gone.length) await db.signup.deleteMany({ where: { organizationId, id: { in: gone.map((g) => g.id) } } });
    return { removed: gone.length, contacts: [...new Set(gone.map((g) => g.contactId))] };
  }
  const rows = await db.ballot.findMany({
    where: { ...where, source: RecordSource.SUPABASE_SYNC },
    select: { id: true, externalId: true },
  });
  const gone = rows.filter((r) => isSourceId(r.externalId) && !seen.has(r.externalId));
  if (gone.length) await db.ballot.deleteMany({ where: { organizationId, id: { in: gone.map((g) => g.id) } } });
  return { removed: gone.length, contacts: [] };
}
