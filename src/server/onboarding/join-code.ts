import { NotificationType, Prisma, Role } from "@/generated/prisma/client";
import { getUserIdentity } from "@/lib/auth/email-verification";
import type { SessionUser } from "@/lib/auth/session";
import {
  emailOnDomain,
  generateJoinCode,
  normalizeDomain,
  normalizeJoinCode,
} from "@/lib/join-code";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { invalidate } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import { withSystemOrgTx, withUserTx, type TxClient } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";
import { notifyUser } from "@/server/notifications";

import { ownPreferredTitle } from "./title";

/**
 * The org's shareable invite code (onboarding "Join with invite code").
 *
 * Admins read and change it on the member path (RLS: OWNER/ADMIN only). A
 * person joining is not a member yet, so the lookup is the definer function
 * app.org_by_join_code(code), which answers only a signed-in caller with a
 * VERIFIED email; the join then runs on the service path for that user,
 * withSystemOrgTx(orgId, { userId }), the same way invitations are accepted.
 *
 * Joining with a code checks, against the org the code belongs to:
 *   - the caller's email is verified (the lookup itself refuses otherwise);
 *   - the code is turned on and the org is not being deleted;
 *   - the caller's email is on the org's allowed domain, when one is set.
 */

export interface JoinCodeView {
  code: string;
  enabled: boolean;
  allowedDomain: string | null;
  useCount: number;
  rotatedAt: Date;
}

const joinCodeSelect = {
  code: true,
  enabled: true,
  allowedDomain: true,
  useCount: true,
  rotatedAt: true,
} satisfies Prisma.OrgJoinCodeSelect;

/** Five tries at a fresh code; a collision in 8.5e11 is not expected at all. */
async function insertWithFreshCode(db: TxClient, organizationId: string, userId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.$executeRaw`SAVEPOINT join_code`;
      const row = await db.orgJoinCode.create({
        data: { organizationId, code: generateJoinCode(), createdById: userId },
        select: joinCodeSelect,
      });
      await db.$executeRaw`RELEASE SAVEPOINT join_code`;
      return row;
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT join_code`;
      if (sqlStateOf(error) !== "23505") throw error;
    }
  }
  throw new Error("could not generate a unique invite code");
}

/**
 * The org's invite code, created on first use. Call inside the admin's
 * member transaction (withOrgTx / withOrgAction); RLS refuses anyone else.
 */
export async function getOrCreateJoinCode(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<JoinCodeView> {
  const existing = await db.orgJoinCode.findUnique({
    where: { organizationId },
    select: joinCodeSelect,
  });
  if (existing) return existing;
  const created = await insertWithFreshCode(db, organizationId, userId);
  await writeOrgAuditLog(db, {
    organizationId,
    action: "join_code.created",
    targetType: "OrgJoinCode",
    targetId: organizationId,
  });
  return created;
}

/** A new code; the old one stops working at commit. */
export async function rotateJoinCode(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<JoinCodeView> {
  await getOrCreateJoinCode(db, organizationId, userId);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.$executeRaw`SAVEPOINT join_code_rotate`;
      const row = await db.orgJoinCode.update({
        where: { organizationId },
        data: { code: generateJoinCode(), rotatedAt: new Date(), useCount: 0 },
        select: joinCodeSelect,
      });
      await db.$executeRaw`RELEASE SAVEPOINT join_code_rotate`;
      await writeOrgAuditLog(db, {
        organizationId,
        action: "join_code.rotated",
        targetType: "OrgJoinCode",
        targetId: organizationId,
      });
      return row;
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT join_code_rotate`;
      if (sqlStateOf(error) !== "23505") throw error;
    }
  }
  throw new Error("could not generate a unique invite code");
}

export type JoinCodeSettingsResult =
  { ok: true; code: JoinCodeView } | { ok: false; error: string };

/** Turn the code on or off, and set or clear the allowed email domain. */
export async function updateJoinCodeSettings(
  db: TxClient,
  organizationId: string,
  userId: string,
  input: { enabled?: boolean; allowedDomain?: string | null },
): Promise<JoinCodeSettingsResult> {
  const data: Prisma.OrgJoinCodeUpdateInput = {};
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.allowedDomain !== undefined) {
    const raw = input.allowedDomain?.trim() ?? "";
    const domain = normalizeDomain(raw);
    if (raw && !domain) return { ok: false, error: "Enter a domain like northeastern.edu." };
    data.allowedDomain = domain;
  }
  await getOrCreateJoinCode(db, organizationId, userId);
  const row = await db.orgJoinCode.update({
    where: { organizationId },
    data,
    select: joinCodeSelect,
  });
  await writeOrgAuditLog(db, {
    organizationId,
    action: "join_code.updated",
    targetType: "OrgJoinCode",
    targetId: organizationId,
    diff: { enabled: row.enabled, allowedDomain: row.allowedDomain },
  });
  return { ok: true, code: row };
}

// ---------------------------------------------------------------- joining

/** Per user: enough for typos, far too few to guess a code. */
const LOOKUP_LIMIT = { limit: 10, windowSec: 15 * 60 };

export interface JoinCodeOrg {
  organizationId: string;
  orgName: string;
  orgSlug: string;
  orgLogo: Prisma.JsonValue | null;
  memberCount: number;
  /** The domain the code is limited to, when there is one. */
  allowedDomain: string | null;
}

export type JoinCodeCheck =
  | { ok: true; org: JoinCodeOrg; alreadyMember: boolean }
  | {
      ok: false;
      reason:
        | "invalid_format"
        | "not_found"
        | "disabled"
        | "org_inactive"
        | "wrong_domain"
        | "unverified"
        | "rate_limited";
      message: string;
    };

interface LookupRow {
  organizationId: string;
  orgName: string;
  orgSlug: string;
  orgLogo: Prisma.JsonValue | null;
  enabled: boolean;
  allowedDomain: string | null;
  deleted: boolean;
  memberCount: number;
}

/**
 * Checks a code for `user` and says which org it opens. Used both to show
 * "You're joining X" before the user commits, and again by joinWithCode.
 */
export async function checkJoinCode(user: SessionUser, rawCode: string): Promise<JoinCodeCheck> {
  const code = normalizeJoinCode(rawCode);
  if (!code)
    return { ok: false, reason: "invalid_format", message: "Invite codes look like ABCD-EFGH." };

  const identity = await getUserIdentity(user.id);
  if (!identity?.emailVerified) {
    return {
      ok: false,
      reason: "unverified",
      message: "Verify your email address before joining an organization.",
    };
  }

  const limit = await checkRateLimit(
    rateLimitKey("join-code", user.id),
    LOOKUP_LIMIT.limit,
    LOOKUP_LIMIT.windowSec,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      message: `Too many tries. Try again ${retryAfterText(limit)}.`,
    };
  }

  const { row, alreadyMember } = await withUserTx(user.id, async ({ db }) => {
    const rows = await db.$queryRaw<LookupRow[]>`
      SELECT "organizationId", "orgName", "orgSlug", "orgLogo", "enabled", "allowedDomain", "deleted", "memberCount"
        FROM app.org_by_join_code(${code})`;
    const found = rows[0] ?? null;
    const member = found
      ? await db.membership.findFirst({
          where: { userId: user.id, organizationId: found.organizationId },
          select: { id: true },
        })
      : null;
    return { row: found, alreadyMember: Boolean(member) };
  });

  if (!row)
    return {
      ok: false,
      reason: "not_found",
      message: "That code doesn't match any organization. Check it with whoever sent it.",
    };
  if (row.deleted)
    return { ok: false, reason: "org_inactive", message: "This organization is no longer active." };
  if (!row.enabled)
    return {
      ok: false,
      reason: "disabled",
      message: "This organization has turned its invite code off. Ask an admin for a new one.",
    };
  if (row.allowedDomain && !emailOnDomain(identity.email, row.allowedDomain)) {
    return {
      ok: false,
      reason: "wrong_domain",
      message: `${row.orgName} only accepts @${row.allowedDomain} addresses. Sign up with that address, or ask an admin for an email invite.`,
    };
  }
  return {
    ok: true,
    alreadyMember,
    org: {
      organizationId: row.organizationId,
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      orgLogo: row.orgLogo,
      memberCount: row.memberCount,
      allowedDomain: row.allowedDomain,
    },
  };
}

export type JoinWithCodeResult =
  { ok: true; orgId: string; orgSlug: string } | { ok: false; message: string };

/**
 * Joins the org behind `rawCode` as a MEMBER, with the title the user picked
 * during profile setup. The code is re-read under a row lock inside the
 * join transaction, so a code rotated or turned off a moment ago is refused.
 */
export async function joinWithCode(
  user: SessionUser,
  rawCode: string,
): Promise<JoinWithCodeResult> {
  const check = await checkJoinCode(user, rawCode);
  if (!check.ok) return { ok: false, message: check.message };
  const { org } = check;
  if (check.alreadyMember) return { ok: true, orgId: org.organizationId, orgSlug: org.orgSlug };

  const code = normalizeJoinCode(rawCode)!;
  const title = await ownPreferredTitle(user.id);

  const result = await withSystemOrgTx(org.organizationId, { userId: user.id }, async ({ db }) => {
    const locked = await db.$queryRaw<{ code: string; enabled: boolean }[]>`
      SELECT "code", "enabled" FROM "OrgJoinCode" WHERE "organizationId" = ${org.organizationId} FOR UPDATE`;
    const current = locked[0];
    if (!current || current.code !== code || !current.enabled) {
      return {
        ok: false as const,
        message: "This invite code just changed. Ask an admin for the new one.",
      };
    }
    const existing = await db.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: org.organizationId } },
      select: { id: true },
    });
    if (!existing) {
      await db.membership.create({
        data: { userId: user.id, organizationId: org.organizationId, role: Role.MEMBER, title },
      });
      await db.orgJoinCode.update({
        where: { organizationId: org.organizationId },
        data: { useCount: { increment: 1 } },
        select: { organizationId: true },
      });
      await writeOrgAuditLog(db, {
        organizationId: org.organizationId,
        action: "join_code.used",
        targetType: "Membership",
        targetId: user.id,
        diff: { role: Role.MEMBER },
      });
      // Tell the org's admins someone joined with the code.
      const admins = await db.membership.findMany({
        where: { organizationId: org.organizationId, role: { in: [Role.OWNER, Role.ADMIN] } },
        select: { userId: true },
      });
      for (const admin of admins) {
        await notifyUser(db, org.organizationId, admin.userId, {
          type: NotificationType.INVITE_ACCEPTED,
          title: `${user.name ?? user.email} joined ${org.orgName} with the invite code`,
          linkUrl: `/app/${org.orgSlug}/settings/members`,
          actorId: user.id,
        });
      }
    }
    return { ok: true as const, orgId: org.organizationId, orgSlug: org.orgSlug };
  });
  if (result.ok) invalidate([tags.members(org.organizationId)]);
  return result;
}
