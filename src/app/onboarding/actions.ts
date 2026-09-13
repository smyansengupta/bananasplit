"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { Role } from "@/generated/prisma/client";
import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { acceptInvitation } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";

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

  const existing = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return { error: "That URL is already taken." };
  }

  const org = await prisma.organization.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      memberships: { create: { userId: user.id, role: Role.OWNER } },
    },
  });

  await setActiveOrgCookie(org.id);
  redirect(`/app/${org.slug}`);
}

export async function checkSlugAvailability(slug: string): Promise<boolean> {
  await requireUser();
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
