import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { PollResponder } from "@/components/calendar/poll-responder";

import { getPollById } from "../../queries";
import { SharePollLink } from "./share-poll-link";

export default async function PollDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/[pollId]">) {
  const { orgSlug, pollId } = await params;

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

  const poll = await getPollById(pollId);
  if (!poll || poll.organizationId !== org.id) {
    notFound();
  }

  const canFinalize =
    poll.createdById === ctx.user.id || ctx.role === Role.OWNER || ctx.role === Role.ADMIN;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SharePollLink pollId={poll.id} />
      <PollResponder
        poll={poll}
        currentUserId={ctx.user.id}
        orgId={org.id}
        orgSlug={orgSlug}
        canFinalize={canFinalize}
      />
    </div>
  );
}
