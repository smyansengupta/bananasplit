import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { Role } from "@/generated/prisma/client";
import { getUserIdentity } from "@/lib/auth/email-verification";
import {
  ORG_CREATION_CODE_DAYS,
  ORG_CREATION_DENIAL_MESSAGES,
  ORG_CREATION_LIMITS,
  canIssueOrgCreationCodes,
  orgCreationPolicy,
} from "@/lib/auth/org-creation";
import type { SessionUser } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { isReservedSlug } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timezones";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx, withUserTx } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";
import { ownPreferredTitle } from "@/server/onboarding/join-code";

/**
 * Creating an organization (onboarding and /app/new) and the platform
 * admins' org-creation codes.
 *
 * Creation runs on the service path for the creating user,
 * withSystemOrgTx(newOrgId, { userId }), in one transaction: redeem the code
 * (invite mode), insert the Organization (the organization_defaults trigger
 * adds OrgSettings and the built-in databases; organization_slug_guard
 * rejects reserved and retired slugs), then the creator's OWNER Membership
 * (membership_guard's bootstrap rule: the first member of a brand-new org
 * may be its OWNER). app_user can insert neither row.
 */

export const orgNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80, "Name must be at most 80 characters");

export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "URL must be at least 2 characters")
  .max(60, "URL must be at most 60 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only");

const createOrgSchema = z.object({
  name: orgNameSchema,
  slug: orgSlugSchema,
  timezone: z
    .string()
    .trim()
    .default("UTC")
    .refine((tz) => isValidTimeZone(tz), "Choose a valid timezone"),
  code: z.string().trim().max(100).optional(),
});

export type CreateOrgInput = z.input<typeof createOrgSchema>;

export type CreateOrgResult =
  { ok: true; orgId: string; slug: string } | { ok: false; error: string };

export function hashOrgCreationCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase().replace(/[\s-]/g, "")).digest("hex");
}

/** A new org id (cuid-like: lowercase letters and digits). */
export function newOrgId(): string {
  return `c${Date.now().toString(36)}${randomBytes(9).toString("hex")}`;
}

/**
 * Whether `slug` can be taken by a new org or a rename: not reserved, not
 * any org's live or soft-deleted slug, never retired (app.slug_available).
 */
export async function isSlugAvailable(userId: string, slug: string): Promise<boolean> {
  const parsed = orgSlugSchema.safeParse(slug);
  if (!parsed.success || isReservedSlug(parsed.data)) return false;
  const rows = await withUserTx(
    userId,
    ({ db }) => db.$queryRaw<{ ok: boolean }[]>`SELECT app.slug_available(${parsed.data}) AS ok`,
  );
  return rows[0]?.ok === true;
}

async function limited(
  key: string,
  limit: { limit: number; windowSec: number },
): Promise<string | null> {
  const result = await checkRateLimit(key, limit.limit, limit.windowSec);
  return result.allowed ? null : retryAfterText(result);
}

export async function createOrganization(
  user: SessionUser,
  input: CreateOrgInput,
): Promise<CreateOrgResult> {
  // Checked on the server whatever the page showed.
  const identity = await getUserIdentity(user.id);
  const policy = orgCreationPolicy(identity);
  if (policy.denial) return { ok: false, error: ORG_CREATION_DENIAL_MESSAGES[policy.denial] };

  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { name, slug, timezone } = parsed.data;
  if (isReservedSlug(slug)) return { ok: false, error: "That URL is reserved. Pick another." };

  const code = parsed.data.code ?? "";
  if (policy.requiresCode && !code) {
    return { ok: false, error: "Enter the organization code a platform admin gave you." };
  }
  if (!(await isSlugAvailable(user.id, slug))) {
    return { ok: false, error: "That URL is already taken." };
  }

  // Only attempts that pass validation count, so a typo does not use up the allowance.
  const perUser = await limited(
    rateLimitKey("org-create", user.id),
    ORG_CREATION_LIMITS.perUserPerDay,
  );
  if (perUser)
    return {
      ok: false,
      error: `You've created several organizations recently. Try again ${perUser}.`,
    };
  if (policy.openLimits) {
    const monthly = await limited(
      rateLimitKey("org-create-open", user.id),
      ORG_CREATION_LIMITS.perUserOpen,
    );
    if (monthly)
      return {
        ok: false,
        error: `You can create one organization every 30 days. Try again ${monthly}.`,
      };
    const platform = await limited(
      rateLimitKey("org-create-platform", "all"),
      ORG_CREATION_LIMITS.platformOpenPerDay,
    );
    if (platform)
      return { ok: false, error: `New organizations are paused for today. Try again ${platform}.` };
  }

  const orgId = newOrgId();
  const title = await ownPreferredTitle(user.id);
  try {
    const result = await withSystemOrgTx(orgId, { userId: user.id }, async ({ db }) => {
      if (policy.requiresCode) {
        const rows = await db.$queryRaw<{ ok: boolean }[]>`
          SELECT app.redeem_org_creation_code(${hashOrgCreationCode(code)}, ${user.id}) AS ok`;
        if (rows[0]?.ok !== true)
          return { ok: false as const, error: "That code is invalid, used or expired." };
      }
      await db.organization.create({ data: { id: orgId, name, slug, timezone } });
      await db.membership.create({
        data: { organizationId: orgId, userId: user.id, role: Role.OWNER, title },
      });
      await writeOrgAuditLog(db, {
        organizationId: orgId,
        action: "org.created",
        targetType: "Organization",
        targetId: orgId,
        diff: { name, slug, timezone, mode: policy.mode, withCode: policy.requiresCode },
      });
      return { ok: true as const, orgId, slug };
    });
    return result;
  } catch (error) {
    // The database also reserves every slug an org has given up (renamed or
    // deleted orgs): 23505 either way.
    if (sqlStateOf(error) === "23505") return { ok: false, error: "That URL is already taken." };
    throw error;
  }
}

// ---------------------------------------------------------------- Codes

export interface OrgCreationCodeRow {
  id: string;
  createdByEmail: string;
  note: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  usedByUserId: string | null;
  usedOrgId: string | null;
  createdAt: Date;
}

/** A readable single-use code: 4 groups of 4 (Crockford base32, no 0/O/1/I/L/U). */
export function generateOrgCreationCode(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

async function requireCodeIssuer(userId: string): Promise<{ email: string }> {
  const identity = await getUserIdentity(userId);
  const check = canIssueOrgCreationCodes(identity);
  if (!check.allowed || !identity) throw new OrgCodeError(check.reason ?? "Not allowed.");
  return { email: identity.email };
}

export class OrgCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgCodeError";
  }
}

/** Issues a code; returns the plaintext ONCE (only its sha256 is stored). */
export async function issueOrgCreationCode(
  userId: string,
  note: string | null,
): Promise<{ code: string; expiresAt: Date }> {
  const issuer = await requireCodeIssuer(userId);
  const code = generateOrgCreationCode();
  const expiresAt = new Date(Date.now() + ORG_CREATION_CODE_DAYS * 24 * 60 * 60 * 1000);
  const cleanNote = note?.trim().slice(0, 200) || null;
  await withSystemOrgTx(
    null,
    { userId },
    ({ db }) =>
      db.$queryRaw`
      SELECT app.issue_org_creation_code(${hashOrgCreationCode(code)}, ${issuer.email}, ${cleanNote},
                                         ${expiresAt.toISOString()}::timestamp) AS id`,
  );
  return { code, expiresAt };
}

export async function listOrgCreationCodes(userId: string): Promise<OrgCreationCodeRow[]> {
  const identity = await getUserIdentity(userId);
  const check = canIssueOrgCreationCodes(identity);
  // Listing is allowed for platform admins even while issuing is off.
  if (!check.allowed && check.reason === "Only platform admins can issue codes.") {
    throw new OrgCodeError(check.reason);
  }
  return withSystemOrgTx(
    null,
    { userId },
    ({ db }) =>
      db.$queryRaw<OrgCreationCodeRow[]>`
      SELECT "id", "createdByEmail", "note", "expiresAt", "usedAt", "usedByUserId", "usedOrgId", "createdAt"
        FROM app.list_org_creation_codes(200)`,
  );
}
