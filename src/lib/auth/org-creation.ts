import { normalizeEmail } from "@/lib/auth/normalize-email";

/**
 * Who may create an organization (0A Fix 4(c) and Fix 16).
 *
 * - Always: the account's email must be verified, so an unverified sign-up
 *   can never hold a Membership (it would be the new org's OWNER).
 * - In production: only the platform admins in PLATFORM_ADMIN_EMAILS, until
 *   the owners decide the self-serve policy. Phase 1 replaces this with
 *   PLATFORM_ORG_CREATION_ENABLED and org-creation codes. Previews and local
 *   development are unrestricted.
 *
 * "Production" is VERCEL_ENV=production, or NODE_ENV=production on a host
 * that is not Vercel (fail safe: a self-hosted production build is locked).
 */

export type OrgCreationDenial = "unverified" | "locked";

export function isProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean),
  );
}

export function orgCreationDenial(
  identity: { email: string; emailVerified: Date | null } | null,
  env: NodeJS.ProcessEnv = process.env,
): OrgCreationDenial | null {
  if (!identity?.emailVerified) return "unverified";
  if (isProductionDeployment(env) && !platformAdminEmails(env).has(normalizeEmail(identity.email))) {
    return "locked";
  }
  return null;
}

export const ORG_CREATION_DENIAL_MESSAGES: Record<OrgCreationDenial, string> = {
  unverified: "Verify your email address before creating an organization.",
  locked:
    "Creating organizations is limited to platform admins for now. Ask your club's president for an invite.",
};
