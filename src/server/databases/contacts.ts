import { writeOrgAuditLog } from "@/server/audit";
import type { SystemContext } from "@/server/db/context";
import { maskEmail } from "@/server/sync/supabase-map";

import { DatabaseEditError, newId } from "./admin";
import { afterDataChange } from "./rollups";

/**
 * Contact merge and unmerge (Phase 4b identity bridge). Run on the service
 * path, withSystemOrgTx(orgId, { userId }), after the action has checked
 * databases.write: a merge must move every row of the contact, including
 * rows the acting admin's tier cannot see (signups under an OWNER-only
 * setting, ballots), and must never leave half a person behind.
 *
 * Merge: the loser's emails, check-ins, signups and ballots move to the
 * survivor, then the loser is deleted. Where both have a check-in for the
 * same session, or a signup for the same term, the survivor's row stays and
 * the loser's duplicate is removed (it is the same person counted twice; the
 * sync resolves the website row to the survivor and skips it from then on).
 *
 * Unmerge: an email address is split off into a new contact. Suite-native
 * rows stay where they are; the next weekly reconcile re-attributes the
 * website's rows for that address (each synced row is re-resolved by its
 * source email), so the split is complete after one reconcile.
 */

export interface MergeContactsResult {
  survivorId: string;
  moved: { emails: number; attendance: number; signups: number; ballots: number; duplicates: number };
}

export async function mergeContacts(
  ctx: SystemContext & { organizationId: string },
  survivorId: string,
  loserId: string,
): Promise<MergeContactsResult> {
  const org = ctx.organizationId;
  if (survivorId === loserId) throw new DatabaseEditError("Pick two different people to merge.");
  const [survivor, loser] = [
    await ctx.db.contact.findFirst({ where: { id: survivorId, organizationId: org }, select: { id: true, userId: true, displayName: true, unsubscribedAt: true, firstSeenAt: true } }),
    await ctx.db.contact.findFirst({ where: { id: loserId, organizationId: org }, select: { id: true, userId: true, displayName: true, unsubscribedAt: true, firstSeenAt: true } }),
  ];
  if (!survivor || !loser) throw new DatabaseEditError("One of these people no longer exists.");
  if (survivor.userId && loser.userId && survivor.userId !== loser.userId) {
    throw new DatabaseEditError("These people are linked to two different members.");
  }

  const emails = await ctx.db.contactEmail.updateMany({
    where: { organizationId: org, contactId: loser.id },
    data: { contactId: survivor.id, isPrimary: false },
  });

  // Check-ins.
  const survivorEvents = new Set(
    (await ctx.db.attendance.findMany({ where: { organizationId: org, contactId: survivor.id }, select: { eventId: true } })).map((a) => a.eventId),
  );
  const loserAttendance = await ctx.db.attendance.findMany({
    where: { organizationId: org, contactId: loser.id },
    select: { id: true, eventId: true },
  });
  const move: string[] = [];
  const remove: string[] = [];
  for (const a of loserAttendance) {
    if (!survivorEvents.has(a.eventId)) move.push(a.id);
    else remove.push(a.id);
  }
  // The loser is deleted below, so none of its check-ins can stay behind. A
  // duplicate check-in (both people at the same session) is one person
  // counted twice: it is removed, synced or not. It stays removed: the sync
  // resolves that website row's email to the survivor, who already has a
  // check-in for the session, and skips it.
  if (move.length) {
    await ctx.db.attendance.updateMany({ where: { organizationId: org, id: { in: move } }, data: { contactId: survivor.id } });
  }
  if (remove.length) {
    await ctx.db.attendance.deleteMany({ where: { organizationId: org, id: { in: remove } } });
  }

  // Signups (one per contact and term).
  const survivorTerms = new Set(
    (await ctx.db.signup.findMany({ where: { organizationId: org, contactId: survivor.id }, select: { term: true } })).map((s) => s.term ?? ""),
  );
  const loserSignups = await ctx.db.signup.findMany({
    where: { organizationId: org, contactId: loser.id },
    select: { id: true, term: true },
  });
  const moveSignups = loserSignups.filter((s) => !survivorTerms.has(s.term ?? "")).map((s) => s.id);
  const dropSignups = loserSignups.filter((s) => survivorTerms.has(s.term ?? "")).map((s) => s.id);
  if (moveSignups.length) {
    await ctx.db.signup.updateMany({ where: { organizationId: org, id: { in: moveSignups } }, data: { contactId: survivor.id } });
  }
  if (dropSignups.length) {
    await ctx.db.signup.deleteMany({ where: { organizationId: org, id: { in: dropSignups } } });
  }

  const ballots = await ctx.db.ballot.updateMany({
    where: { organizationId: org, voterContactId: loser.id },
    data: { voterContactId: survivor.id },
  });

  await ctx.db.contact.update({
    where: { id: survivor.id },
    data: {
      userId: survivor.userId ?? loser.userId,
      displayName: survivor.displayName ?? loser.displayName,
      unsubscribedAt: survivor.unsubscribedAt ?? loser.unsubscribedAt,
      firstSeenAt:
        survivor.firstSeenAt && loser.firstSeenAt
          ? new Date(Math.min(survivor.firstSeenAt.getTime(), loser.firstSeenAt.getTime()))
          : (survivor.firstSeenAt ?? loser.firstSeenAt),
    },
  });
  // Pick a primary address for the survivor if it has none.
  const primary = await ctx.db.contactEmail.count({ where: { organizationId: org, contactId: survivor.id, isPrimary: true } });
  if (primary === 0) {
    const first = await ctx.db.contactEmail.findFirst({ where: { organizationId: org, contactId: survivor.id }, orderBy: { createdAt: "asc" } });
    if (first) {
      await ctx.db.contactEmail.update({ where: { id: first.id }, data: { isPrimary: true } });
      const masked = maskEmail(first.emailNormalized);
      await ctx.db.contact.update({ where: { id: survivor.id }, data: { emailMasked: masked.masked, emailDomain: masked.domain } });
    }
  }
  await ctx.db.contactTermStats.deleteMany({ where: { organizationId: org, contactId: loser.id } });
  await ctx.db.contact.delete({ where: { id: loser.id } });

  const moved = {
    emails: emails.count,
    attendance: move.length,
    signups: moveSignups.length,
    ballots: ballots.count,
    duplicates: remove.length + dropSignups.length,
  };
  await writeOrgAuditLog(ctx.db, {
    organizationId: org,
    action: "contact.merged",
    targetType: "Contact",
    targetId: survivor.id,
    diff: { mergedContactId: loser.id, ...moved },
  });
  await afterDataChange(ctx.db, org, [survivor.id]);
  return { survivorId: survivor.id, moved };
}

/** Splits one address off a contact into a new contact (unmerge). */
export async function splitContactEmail(
  ctx: SystemContext & { organizationId: string },
  contactId: string,
  emailId: string,
): Promise<{ newContactId: string }> {
  const org = ctx.organizationId;
  const email = await ctx.db.contactEmail.findFirst({
    where: { id: emailId, organizationId: org, contactId },
    select: { id: true, emailNormalized: true, isPrimary: true },
  });
  if (!email) throw new DatabaseEditError("That address is not on this person.");
  const others = await ctx.db.contactEmail.count({ where: { organizationId: org, contactId, id: { not: email.id } } });
  if (others === 0) throw new DatabaseEditError("This is the person's only address; there is nothing to split.");
  const masked = maskEmail(email.emailNormalized);
  const newContactId = newId("ct_");
  await ctx.db.contact.create({
    data: {
      id: newContactId,
      organizationId: org,
      emailMasked: masked.masked,
      emailDomain: masked.domain,
      firstSeenAt: new Date(),
    },
  });
  await ctx.db.contactEmail.update({ where: { id: email.id }, data: { contactId: newContactId, isPrimary: true } });
  if (email.isPrimary) {
    const next = await ctx.db.contactEmail.findFirst({ where: { organizationId: org, contactId }, orderBy: { createdAt: "asc" } });
    if (next) {
      await ctx.db.contactEmail.update({ where: { id: next.id }, data: { isPrimary: true } });
      const m = maskEmail(next.emailNormalized);
      await ctx.db.contact.update({ where: { id: contactId }, data: { emailMasked: m.masked, emailDomain: m.domain } });
    }
  }
  await writeOrgAuditLog(ctx.db, {
    organizationId: org,
    action: "contact.split",
    targetType: "Contact",
    targetId: contactId,
    diff: { newContactId },
  });
  await afterDataChange(ctx.db, org, [contactId, newContactId]);
  return { newContactId };
}
