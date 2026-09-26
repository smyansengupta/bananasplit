import { notFound } from "next/navigation";

import { PollResponder } from "@/components/calendar/poll-responder";
import { can } from "@/lib/auth/permissions";
import { buildPollView } from "@/lib/polls/poll-view";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getPollSource } from "../../queries";
import { SharePollLink } from "./share-poll-link";

export default async function PollDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/[pollId]">) {
  const { orgSlug, pollId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const poll = await withOrgTx(org.id, ({ db }) => getPollSource(db, org.id, pollId));
  if (!poll) notFound();

  // Finalizing creates an event, which is ADMIN+ (the event service).
  const canFinalize = can({ role }, "events.write");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SharePollLink pollId={poll.id} />
      <PollResponder
        poll={buildPollView(poll, { kind: "member", userId: user.id })}
        respondAs="member"
        orgId={org.id}
        orgSlug={orgSlug}
        canFinalize={canFinalize}
      />
    </div>
  );
}
