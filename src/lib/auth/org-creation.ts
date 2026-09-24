import { normalizeEmail } from "@/lib/auth/normalize-email";

/**
 * Who may create an organization (0A Fix 4(c) and Fix 16, replaced by the
 * Phase 1 org-creation policy). Pure: the server actions call it with the
 * STORED identity, whatever the page showed.
 *
 * - Always: the account's email must be verified, so an unverified sign-up
 *   can never hold a Membership (it would be the new org's OWNER).
 * - Platform admins (PLATFORM_ADMIN_EMAILS) may always create orgs: they
 *   operate the platform and issue org-creation codes.
 * - PLATFORM_ORG_CREATION_ENABLED: while it is false, nobody else may. It
 *   defaults to false in production and true elsewhere (previews, local).
 * - ORG_CREATION_MODE (defaults: "admins" in production, "open" elsewhere):
 *     admins  only platform admins;
 *     invite  anyone with a single-use org-creation code (14 days), issued
 *             by a platform admin at /app/platform/org-codes;
 *     open    any verified user. In production, open mode is limited to one
 *             org per user per 30 days and 20 new orgs per day platform-wide
 *             (ORG_CREATION_LIMITS).
 * Every mode keeps the base limit of 3 new orgs per user per day.
 *
 * "Production" is VERCEL_ENV=production, or NODE_ENV=production on a host
 * that is not Vercel (fail safe: a self-hosted production build is locked).
 */

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type OrgCreationMode = "admins" | "invite" | "open";

export type OrgCreationDenial = "unverified" | "disabled" | "locked";

export interface OrgCreationIdentity {
  email: string;
  emailVerified: Date | null;
}

export interface OrgCreationPolicy {
  /** Why this user may not create an org at all, or null. */
  denial: OrgCreationDenial | null;
  /** A single-use org-creation code is required (invite mode, non-admins). */
  requiresCode: boolean;
  isPlatformAdmin: boolean;
  mode: OrgCreationMode;
  /** Open mode in production: the stricter per-user and platform limits apply. */
  openLimits: boolean;
}

export const ORG_CREATION_LIMITS = {
  /** Every mode, every environment. */
  perUserPerDay: { limit: 3, windowSec: 24 * 60 * 60 },
  /** Open mode in production. */
  perUserOpen: { limit: 1, windowSec: 30 * 24 * 60 * 60 },
  platformOpenPerDay: { limit: 20, windowSec: 24 * 60 * 60 },
} as const;

/** How long an org-creation code stays valid. */
export const ORG_CREATION_CODE_DAYS = 14;

export function isProductionDeployment(env: Env = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export function platformAdminEmails(env: Env = process.env): Set<string> {
  return new Set(
    (env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean),
  );
}

export function isPlatformAdmin(
  identity: OrgCreationIdentity | null,
  env: Env = process.env,
): boolean {
  if (!identity?.emailVerified) return false;
  return platformAdminEmails(env).has(normalizeEmail(identity.email));
}

function flag(value: string | undefined): boolean | null {
  const v = (value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

/** PLATFORM_ORG_CREATION_ENABLED, defaulting to false in production. */
export function orgCreationEnabled(env: Env = process.env): boolean {
  return flag(env.PLATFORM_ORG_CREATION_ENABLED) ?? !isProductionDeployment(env);
}

export function orgCreationMode(env: Env = process.env): OrgCreationMode {
  const raw = (env.ORG_CREATION_MODE ?? "").trim().toLowerCase();
  if (raw === "admins" || raw === "invite" || raw === "open") return raw;
  return isProductionDeployment(env) ? "admins" : "open";
}

export function orgCreationPolicy(
  identity: OrgCreationIdentity | null,
  env: Env = process.env,
): OrgCreationPolicy {
  const mode = orgCreationMode(env);
  const admin = isPlatformAdmin(identity, env);
  const base = { mode, isPlatformAdmin: admin, requiresCode: false, openLimits: false };
  if (!identity?.emailVerified) return { ...base, denial: "unverified" };
  if (admin) return { ...base, denial: null };
  if (!orgCreationEnabled(env)) return { ...base, denial: "disabled" };
  if (mode === "admins") return { ...base, denial: "locked" };
  if (mode === "invite") return { ...base, denial: null, requiresCode: true };
  return { ...base, denial: null, openLimits: isProductionDeployment(env) };
}

/** Back-compat shape: the denial alone. */
export function orgCreationDenial(
  identity: OrgCreationIdentity | null,
  env: Env = process.env,
): OrgCreationDenial | null {
  return orgCreationPolicy(identity, env).denial;
}

/** Whether `identity` may issue org-creation codes (and see them). */
export function canIssueOrgCreationCodes(
  identity: OrgCreationIdentity | null,
  env: Env = process.env,
): { allowed: boolean; reason?: string } {
  if (!isPlatformAdmin(identity, env))
    return { allowed: false, reason: "Only platform admins can issue codes." };
  if (!orgCreationEnabled(env)) {
    return {
      allowed: false,
      reason:
        "Org creation is switched off (PLATFORM_ORG_CREATION_ENABLED), so codes cannot be issued.",
    };
  }
  if (orgCreationMode(env) !== "invite") {
    return { allowed: false, reason: "Codes are used only when ORG_CREATION_MODE=invite." };
  }
  return { allowed: true };
}

export const ORG_CREATION_DENIAL_MESSAGES: Record<OrgCreationDenial, string> = {
  unverified: "Verify your email address before creating an organization.",
  disabled:
    "Creating new organizations is switched off on this platform for now. Ask your club's president for an invite.",
  locked:
    "Creating organizations is limited to platform admins for now. Ask your club's president for an invite.",
};
