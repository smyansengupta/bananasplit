import { createHash, randomBytes } from "node:crypto";

import type { Role } from "@/generated/prisma/enums";

/**
 * Invitation tokens and shared copy. The database work (create, resend,
 * revoke, look up by token, accept) lives in src/server/settings/invitations.ts,
 * on the RLS-enforced roles.
 */

export const INVITATION_EXPIRY_DAYS = 7;

export function invitationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** An invitation as the joining user sees it (no token, no inviter email). */
export interface InvitationForJoin {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedById: string;
  orgName: string;
  orgSlug: string;
}

export type AcceptInvitationResult =
  | { ok: true; orgId: string; orgSlug: string }
  | {
      ok: false;
      reason: "already_used" | "expired" | "email_mismatch" | "unverified" | "org_inactive";
      invitedEmail?: string;
    };

export const ACCEPT_ERROR_MESSAGES: Record<
  Exclude<AcceptInvitationResult, { ok: true }>["reason"],
  string
> = {
  already_used: "This invite has already been used.",
  expired: "This invite has expired.",
  email_mismatch: "This invite was sent to a different email address.",
  unverified: "Verify your email address before accepting this invite.",
  org_inactive: "This organization is no longer active.",
};
