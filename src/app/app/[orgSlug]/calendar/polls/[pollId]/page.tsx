import { redirect } from "next/navigation";

import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

/**
 * A poll's old address: a question poll goes on to Forms, a find-a-time
 * poll to Find a time, so links and pins made before either moved still
 * work.
 */
export default async function PollDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/[pollId]">) {
  const { orgSlug, pollId } = await params;
  const { organization: org } = await getOrgContextBySlug(orgSlug);
  const timePoll = await withOrgTx(org.id, ({ db }) =>
    db.availabilityPoll.count({ where: { id: pollId, organizationId: org.id } }),
  );
  redirect(
    timePoll > 0
      ? `/app/${orgSlug}/calendar/find-a-time/${pollId}`
      : `/app/${orgSlug}/forms/polls/${pollId}`,
  );
}
