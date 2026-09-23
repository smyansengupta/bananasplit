"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { Role } from "@/generated/prisma/client";
import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { acceptInvitation } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { isReservedSlug } from "@/lib/slug";
import { sqlStateOf } from "@/server/db/errors";

const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "URL must be at least 2 characters")
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
});

/**
 * Org creation per user (Postgres-backed): every org can store third-party
 * keys under the platform KEK, so creation is limited. Only attempts that
 * pass validation count, so a taken slug does not use up the allowance.
 */
const ORG_CREATION_LIMIT = { limit: 3, windowSec: 24 * 60 * 60 } as const;

export interface CreateOrgState {
  error?: string;
}

export async function createOrganizationAction(
  _prevState: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const user = await requireUser();
  const parsed = createOrgSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (isReservedSlug(parsed.data.slug)) {
    return { error: "That URL is reserved. Pick another." };
  }
  const existing = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return { error: "That URL is already taken." };
  }

  const limited = await checkRateLimit(
    rateLimitKey("org-create", user.id),
    ORG_CREATION_LIMIT.limit,
    ORG_CREATION_LIMIT.windowSec,
  );
  if (!limited.allowed) {
    return {
      error: `You've created several organizations recently. Try again ${retryAfterText(limited)}.`,
    };
  }

  let org;
  try {
    org = await prisma.organization.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        memberships: { create: { userId: user.id, role: Role.OWNER } },
      },
    });
  } catch (error) {
    // The database also reserves every slug an org has given up (renamed or
    // deleted orgs), which this legacy path cannot read: 23505 either way.
    if (sqlStateOf(error) === "23505") {
      return { error: "That URL is already taken." };
    }
    throw error;
  }

  await setActiveOrgCookie(org.id);
  redirect(`/app/${org.slug}`);
}

export async function checkSlugAvailability(slug: string): Promise<boolean> {
  await requireUser();
  if (isReservedSlug(slug)) return false;
  const existing = await prisma.organization.findUnique({ where: { slug } });
  return !existing;
}

const ACCEPT_ERROR_MESSAGES = {
  already_used: "This invite has already been used.",
  expired: "This invite has expired.",
  email_mismatch: "This invite was sent to a different email address.",
} as const;

export async function joinPendingInvitationAction(
  invitationId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) {
    return { error: "This invite no longer exists." };
  }

  const result = await acceptInvitation(invitation, user);
  if (!result.ok) {
    return { error: ACCEPT_ERROR_MESSAGES[result.reason] };
  }

  await setActiveOrgCookie(result.orgId);
  redirect(`/app/${result.orgSlug}`);
}
