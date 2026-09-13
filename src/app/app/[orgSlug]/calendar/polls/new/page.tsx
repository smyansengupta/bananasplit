import { notFound } from "next/navigation";

import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { PollForm } from "@/components/calendar/poll-form";

export default async function NewPollPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/new">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  return <PollForm orgId={org.id} orgSlug={orgSlug} />;
}
