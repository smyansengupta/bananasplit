import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { EventDetailView } from "@/components/calendar/event-detail-view";

import { getEventById, getOrgMembersForPicker } from "../queries";

export default async function EventDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]">) {
  const { orgSlug, eventId } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx: OrgContext;
  try {
    ctx = await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const event = await getEventById(org.id, eventId);
  if (!event) {
    notFound();
  }

  const canEdit =
    event.createdById === ctx.user.id || ctx.role === Role.OWNER || ctx.role === Role.ADMIN;
  const memberships = await getOrgMembersForPicker(org.id);
  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
  }));

  return (
    <EventDetailView
      orgId={org.id}
      orgSlug={orgSlug}
      event={event}
      members={members}
      currentUserId={ctx.user.id}
      canEdit={canEdit}
    />
  );
}
