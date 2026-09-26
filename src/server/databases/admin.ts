import { randomBytes } from "node:crypto";

import { z } from "zod";

import { AttendanceMethod, DatabaseKind, Prisma, RecordSource, SignupSource } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import type { OrgContext, TxClient } from "@/server/db/context";
import { cleanName, maskEmail, normalizeEmail } from "@/server/sync/supabase-map";

import { parseDefinitionImport } from "./ballot-definitions";
import { reevaluateBallots, upsertBallotDefinition } from "./ballots";
import { termOf } from "./format";
import { afterDataChange, markDataChanged } from "./rollups";

/**
 * Admin writes to the Databases section (OWNER/ADMIN, and only for
 * databases whose definition allows edits). Every function runs in the
 * caller's withOrgAction transaction (app_user, RLS enforced), writes an
 * OrgAuditLog row, recomputes the rollups for the touched contacts and
 * invalidates reports after commit.
 *
 * Suite-native rows (source SUITE or CSV) get full create, edit and delete.
 * Rows from the website sync (SUPABASE_SYNC) can be suppressed and given
 * suite-side overlays (a name override, "added to list"), never deleted:
 * the DELETE policies refuse it, and the next sync would bring them back.
 * Nothing is written back to the website.
 */

export class DatabaseEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseEditError";
  }
}

/** Throws unless the viewer may edit rows of a database of `kind`. */
export async function assertCanEdit(ctx: OrgContext, kind: DatabaseKind): Promise<void> {
  if (!can(ctx, "databases.write")) throw new ForbiddenError("Only owners and admins can edit databases.");
  const def = await ctx.db.databaseDefinition.findFirst({
    where: { organizationId: ctx.organizationId, kind, archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { allowEdits: true },
  });
  if (def && !def.allowEdits) throw new ForbiddenError("This database is read-only.");
}

export function newId(prefix: string): string {
  return `${prefix}${randomBytes(12).toString("hex")}`;
}

/** A current member whose verified email is `email`, for auto-linking a contact. */
export async function findMemberByVerifiedEmail(
  db: TxClient,
  organizationId: string,
  email: string,
): Promise<string | null> {
  const members = await db.membership.findMany({
    where: { organizationId, user: { email: { equals: email, mode: "insensitive" } } },
    select: { user: { select: { id: true, emailVerified: true } } },
    take: 2,
  });
  const verified = members.filter((m) => m.user.emailVerified !== null);
  return verified.length === 1 ? verified[0].user.id : null;
}

/**
 * The contact for an address, created when new (with the masked address and
 * a link to the member whose verified email it is). Without an address, a
 * name-only contact is created.
 */
export async function findOrCreateContact(
  db: TxClient,
  organizationId: string,
  input: { email?: string | null; name?: string | null; at?: Date },
): Promise<{ id: string; created: boolean }> {
  const email = normalizeEmail(input.email);
  const name = cleanName(input.name);
  if (email) {
    const existing = await db.contactEmail.findFirst({
      where: { organizationId, emailNormalized: email },
      select: { contactId: true },
    });
    if (existing) return { id: existing.contactId, created: false };
  }
  if (!email && !name) throw new DatabaseEditError("Enter a name or an email address.");
  const id = newId("ct_");
  const masked = email ? maskEmail(email) : null;
  const userId = email ? await findMemberByVerifiedEmail(db, organizationId, email) : null;
  try {
    await db.contact.create({
      data: {
        id,
        organizationId,
        displayName: name,
        emailMasked: masked?.masked ?? null,
        emailDomain: masked?.domain ?? null,
        userId,
        firstSeenAt: input.at ?? new Date(),
        ...(email ? { emails: { create: [{ emailNormalized: email, isPrimary: true }] } } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DatabaseEditError(
        "Someone with that email is already on file, but your role cannot see contact emails. Ask an owner.",
      );
    }
    throw error;
  }
  return { id, created: true };
}

// ---- Attendance ---------------------------------------------------------------

export const manualAttendanceSchema = z
  .object({
    eventId: z.string().min(1).max(100),
    contactId: z.string().min(1).max(100).optional(),
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().max(254).optional(),
    checkedInAt: z.coerce.date().optional(),
    method: z.enum(AttendanceMethod).default(AttendanceMethod.MANUAL),
  })
  .refine((v) => v.contactId || v.name || v.email, "Pick a person or enter a name or email.");

export async function addManualAttendance(ctx: OrgContext, input: z.input<typeof manualAttendanceSchema>) {
  await assertCanEdit(ctx, DatabaseKind.ATTENDANCE);
  const data = manualAttendanceSchema.parse(input);
  const org = ctx.organizationId;
  const event = await ctx.db.event.findFirst({
    where: { id: data.eventId, organizationId: org, deletedAt: null, mergedIntoId: null },
    select: { id: true, startsAt: true, term: true, organization: { select: { timezone: true } } },
  });
  if (!event) throw new NotFoundError("That session no longer exists.");
  let contactId = data.contactId;
  if (contactId) {
    const found = await ctx.db.contact.findFirst({ where: { id: contactId, organizationId: org }, select: { id: true } });
    if (!found) throw new NotFoundError("That person no longer exists.");
  } else {
    contactId = (await findOrCreateContact(ctx.db, org, { email: data.email, name: data.name })).id;
  }
  const already = await ctx.db.attendance.findFirst({
    where: { organizationId: org, eventId: event.id, contactId },
    select: { id: true },
  });
  if (already) throw new DatabaseEditError("This person is already checked in to that session.");
  const checkedInAt = data.checkedInAt ?? event.startsAt;
  const row = await ctx.db.attendance.create({
    data: {
      id: newId("att_"),
      organizationId: org,
      eventId: event.id,
      contactId,
      term: event.term ?? termOf(checkedInAt, event.organization.timezone),
      checkedInAt,
      method: data.method,
      nameAsEntered: cleanName(data.name),
      source: RecordSource.SUITE,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: org,
    action: "attendance.created",
    targetType: "Attendance",
    targetId: row.id,
    diff: { eventId: event.id, method: data.method },
  });
  await afterDataChange(ctx.db, org, [contactId]);
  return row;
}

async function loadAttendance(ctx: OrgContext, id: string) {
  const row = await ctx.db.attendance.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, contactId: true, source: true, suppressedAt: true },
  });
  if (!row) throw new NotFoundError();
  return row;
}

/** Suppress (or restore) a check-in: kept, respected by the sync, excluded from stamps and reports. */
export async function setAttendanceSuppressed(ctx: OrgContext, id: string, suppressed: boolean) {
  await assertCanEdit(ctx, DatabaseKind.ATTENDANCE);
  const row = await loadAttendance(ctx, id);
  await ctx.db.attendance.update({ where: { id: row.id }, data: { suppressedAt: suppressed ? new Date() : null } });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: suppressed ? "attendance.suppressed" : "attendance.restored",
    targetType: "Attendance",
    targetId: row.id,
    diff: { source: row.source },
  });
  await afterDataChange(ctx.db, ctx.organizationId, [row.contactId]);
}

/** Deletes a suite-native check-in. Synced check-ins can only be suppressed. */
export async function deleteAttendance(ctx: OrgContext, id: string) {
  await assertCanEdit(ctx, DatabaseKind.ATTENDANCE);
  const row = await loadAttendance(ctx, id);
  if (row.source === RecordSource.SUPABASE_SYNC) {
    throw new DatabaseEditError("Check-ins from the website can be suppressed but not deleted.");
  }
  const deleted = await ctx.db.attendance.deleteMany({ where: { id: row.id, organizationId: ctx.organizationId } });
  if (deleted.count === 0) throw new DatabaseEditError("That check-in could not be deleted.");
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "attendance.deleted",
    targetType: "Attendance",
    targetId: row.id,
  });
  await afterDataChange(ctx.db, ctx.organizationId, [row.contactId]);
}

/** A suite-side name for one check-in (the website row is unchanged). */
export async function setAttendanceNameOverride(ctx: OrgContext, id: string, name: string | null) {
  await assertCanEdit(ctx, DatabaseKind.ATTENDANCE);
  const row = await loadAttendance(ctx, id);
  await ctx.db.attendance.update({ where: { id: row.id }, data: { nameOverride: cleanName(name) } });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "attendance.renamed",
    targetType: "Attendance",
    targetId: row.id,
  });
}

// ---- Signups -------------------------------------------------------------------

export const manualSignupSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.string().trim().max(254).optional(),
  classYear: z.string().trim().max(32).optional(),
  signedUpAt: z.coerce.date().optional(),
  colleges: z.array(z.string().max(32)).max(16).default([]),
  meetDays: z.array(z.string().max(32)).max(16).default([]),
  interests: z.array(z.string().max(32)).max(16).default([]),
});

export async function addManualSignup(ctx: OrgContext, input: z.input<typeof manualSignupSchema>) {
  await assertCanEdit(ctx, DatabaseKind.SIGNUPS);
  const data = manualSignupSchema.parse(input);
  const org = ctx.organizationId;
  const orgRow = await ctx.db.organization.findUnique({ where: { id: org }, select: { timezone: true } });
  const at = data.signedUpAt ?? new Date();
  const term = termOf(at, orgRow?.timezone ?? "UTC");
  const contact = await findOrCreateContact(ctx.db, org, { email: data.email, name: data.name, at });
  const dup = await ctx.db.signup.findFirst({ where: { organizationId: org, contactId: contact.id, term }, select: { id: true } });
  if (dup) throw new DatabaseEditError("This person already has a signup for that term.");
  const row = await ctx.db.signup.create({
    data: {
      id: newId("sg_"),
      organizationId: org,
      contactId: contact.id,
      term,
      channel: SignupSource.MANUAL,
      classYear: data.classYear || null,
      signedUpAt: at,
      answers: { colleges: data.colleges, meet_days: data.meetDays, interests: data.interests },
      recordSource: RecordSource.SUITE,
    },
    select: { id: true },
  });
  await writeOrgAuditLog(ctx.db, { organizationId: org, action: "signup.created", targetType: "Signup", targetId: row.id });
  await afterDataChange(ctx.db, org, [contact.id]);
  return row;
}

async function loadSignup(ctx: OrgContext, id: string) {
  const row = await ctx.db.signup.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, contactId: true, recordSource: true },
  });
  if (!row) throw new NotFoundError();
  return row;
}

/** Marks signups as added to (or removed from) the mailing list. */
export async function setSignupsAddedToList(ctx: OrgContext, ids: string[], added: boolean) {
  await assertCanEdit(ctx, DatabaseKind.SIGNUPS);
  const unique = [...new Set(ids)].slice(0, 500);
  const rows = await ctx.db.signup.findMany({
    where: { organizationId: ctx.organizationId, id: { in: unique } },
    select: { id: true, contactId: true },
  });
  if (rows.length === 0) throw new NotFoundError();
  await ctx.db.signup.updateMany({
    where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.id) } },
    data: { addedToListAt: added ? new Date() : null },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: added ? "signup.added_to_list" : "signup.removed_from_list",
    targetType: "Signup",
    targetId: rows.length === 1 ? rows[0].id : null,
    diff: { count: rows.length },
  });
  await afterDataChange(ctx.db, ctx.organizationId, rows.map((r) => r.contactId));
  return rows.length;
}

export async function setSignupSuppressed(ctx: OrgContext, id: string, suppressed: boolean) {
  await assertCanEdit(ctx, DatabaseKind.SIGNUPS);
  const row = await loadSignup(ctx, id);
  await ctx.db.signup.update({ where: { id: row.id }, data: { suppressedAt: suppressed ? new Date() : null } });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: suppressed ? "signup.suppressed" : "signup.restored",
    targetType: "Signup",
    targetId: row.id,
  });
  await afterDataChange(ctx.db, ctx.organizationId, [row.contactId]);
}

export async function deleteSignup(ctx: OrgContext, id: string) {
  await assertCanEdit(ctx, DatabaseKind.SIGNUPS);
  const row = await loadSignup(ctx, id);
  if (row.recordSource === RecordSource.SUPABASE_SYNC) {
    throw new DatabaseEditError("Signups from the website can be suppressed but not deleted.");
  }
  const deleted = await ctx.db.signup.deleteMany({ where: { id: row.id, organizationId: ctx.organizationId } });
  if (deleted.count === 0) throw new DatabaseEditError("That signup could not be deleted.");
  await writeOrgAuditLog(ctx.db, { organizationId: ctx.organizationId, action: "signup.deleted", targetType: "Signup", targetId: row.id });
  await afterDataChange(ctx.db, ctx.organizationId, [row.contactId]);
}

// ---- Contacts ------------------------------------------------------------------

/** Renames a contact (suite-side; a later sync never overwrites a set name). */
export async function renameContact(ctx: OrgContext, contactId: string, name: string) {
  await assertCanEdit(ctx, DatabaseKind.ATTENDANCE);
  const clean = cleanName(name);
  if (!clean) throw new DatabaseEditError("Enter a name.");
  const updated = await ctx.db.contact.updateMany({
    where: { id: contactId, organizationId: ctx.organizationId },
    data: { displayName: clean },
  });
  if (updated.count === 0) throw new NotFoundError();
  await writeOrgAuditLog(ctx.db, { organizationId: ctx.organizationId, action: "contact.renamed", targetType: "Contact", targetId: contactId });
}

/** Links a contact to a current member (the database checks membership), or unlinks it. */
export async function linkContactToMember(ctx: OrgContext, contactId: string, userId: string | null) {
  await assertCanEdit(ctx, DatabaseKind.ATTENDANCE);
  if (userId) {
    const member = await ctx.db.membership.count({ where: { organizationId: ctx.organizationId, userId } });
    if (member === 0) throw new DatabaseEditError("Pick a current member.");
  }
  const updated = await ctx.db.contact.updateMany({
    where: { id: contactId, organizationId: ctx.organizationId },
    data: { userId },
  });
  if (updated.count === 0) throw new NotFoundError();
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: userId ? "contact.linked" : "contact.unlinked",
    targetType: "Contact",
    targetId: contactId,
    diff: { userId },
  });
  await markDataChanged(ctx.db, ctx.organizationId);
}

// ---- Ballots -------------------------------------------------------------------

export const definitionImportSchema = z.object({
  json: z.string().min(2).max(200_000),
  linkedEventId: z.string().max(100).nullish(),
  isTest: z.boolean().optional(),
});

/** Imports (or re-imports) a poll definition from the website's poll JSON. */
export async function importBallotDefinition(ctx: OrgContext, input: z.input<typeof definitionImportSchema>) {
  await assertCanEdit(ctx, DatabaseKind.BALLOTS);
  const data = definitionImportSchema.parse(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.json);
  } catch {
    throw new DatabaseEditError("That is not valid JSON.");
  }
  let imported;
  try {
    imported = parseDefinitionImport(parsed);
  } catch (error) {
    throw new DatabaseEditError(error instanceof Error ? error.message.slice(0, 300) : "Invalid poll file.");
  }
  if (data.linkedEventId) {
    const event = await ctx.db.event.count({ where: { id: data.linkedEventId, organizationId: ctx.organizationId, deletedAt: null } });
    if (event === 0) throw new DatabaseEditError("That session no longer exists.");
  }
  const out = await upsertBallotDefinition(
    ctx.db,
    ctx.organizationId,
    imported,
    { linkedEventId: data.linkedEventId ?? undefined, isTest: data.isTest },
    { reevaluate: false },
  );
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: out.created ? "ballot_definition.created" : "ballot_definition.updated",
    targetType: "BallotDefinition",
    targetId: out.id,
    diff: { slug: imported.slug, questions: imported.definition.questions.length },
  });
  await markDataChanged(ctx.db, ctx.organizationId);
  return { id: out.id, created: out.created, slug: imported.slug };
}

/**
 * Re-links and re-classifies the ballots of `slug` after a definition change.
 * Service path (withSystemOrgTx): the acting admin's tier may not see
 * individual ballots, but every ballot of the poll must be re-evaluated.
 * Idempotent; call it after the definition's own transaction commits.
 */
export async function reevaluatePoll(db: TxClient, organizationId: string, slug: string) {
  const result = await reevaluateBallots(db, organizationId, [slug], { explode: "all" });
  await markDataChanged(db, organizationId);
  return result;
}

export const definitionPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  opensAt: z.coerce.date().nullable().optional(),
  closesAt: z.coerce.date().nullable().optional(),
  linkedEventId: z.string().max(100).nullable().optional(),
  isTest: z.boolean().optional(),
});

export async function updateBallotDefinition(ctx: OrgContext, id: string, patch: z.input<typeof definitionPatchSchema>) {
  await assertCanEdit(ctx, DatabaseKind.BALLOTS);
  const data = definitionPatchSchema.parse(patch);
  const def = await ctx.db.ballotDefinition.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, slug: true } });
  if (!def) throw new NotFoundError();
  if (data.opensAt && data.closesAt && data.closesAt <= data.opensAt) {
    throw new DatabaseEditError("The poll must close after it opens.");
  }
  await ctx.db.ballotDefinition.update({ where: { id: def.id }, data });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "ballot_definition.updated",
    targetType: "BallotDefinition",
    targetId: def.id,
    diff: { ...data },
  });
  await markDataChanged(ctx.db, ctx.organizationId);
  return { slug: def.slug };
}

/** Suppress (exclude) or restore one ballot. */
export async function setBallotSuppressed(ctx: OrgContext, ballotId: string, suppressed: boolean) {
  await assertCanEdit(ctx, DatabaseKind.BALLOTS);
  const ballot = await ctx.db.ballot.findFirst({
    where: { id: ballotId, organizationId: ctx.organizationId },
    select: { id: true, pollSlug: true },
  });
  if (!ballot) throw new NotFoundError();
  await ctx.db.ballot.update({ where: { id: ballot.id }, data: { excludedReason: suppressed ? "suppressed" : null } });
  if (!suppressed) await reevaluateBallots(ctx.db, ctx.organizationId, [ballot.pollSlug]);
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: suppressed ? "ballot.suppressed" : "ballot.restored",
    targetType: "Ballot",
    targetId: ballot.id,
  });
  await markDataChanged(ctx.db, ctx.organizationId);
}
