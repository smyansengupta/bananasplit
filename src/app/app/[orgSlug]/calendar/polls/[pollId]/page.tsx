import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PollResponder } from "@/components/calendar/poll-responder";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { buildPollView } from "@/lib/polls/poll-view";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getPollSource } from "../../queries";
import { DeletePollButton } from "./poll-actions";
import { SharePollLink } from "./share-poll-link";

export default async function PollDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/[pollId]">) {
  const { orgSlug, pollId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const poll = await getPollSource(db, org.id, pollId);
    if (!poll) return null;
    // Members see each other by name inside the app (they already do on
    // event pages); only current members, and never on the public link.
    const userIds = [...new Set(poll.responses.flatMap((r) => (r.userId ? [r.userId] : [])))];
    const members = userIds.length
      ? await db.membership.findMany({
          where: { organizationId: org.id, userId: { in: userIds } },
          select: { user: { select: { id: true, name: true } } },
        })
      : [];
    return { poll, memberNames: new Map(members.map((m) => [m.user.id, m.user.name ?? ""])) };
  });
  if (!loaded) notFound();
  const { poll, memberNames } = loaded;

  // Finalizing creates an event, which is ADMIN+ (the event service).
  const canFinalize = can({ role }, "events.write");
  const canDelete = poll.createdById === user.id || canFinalize;
  const isOpen = !poll.finalizedEventId && !(poll.closesAt && poll.closesAt < new Date());

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href={`/app/${orgSlug}/calendar/polls`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Availability polls
      </Link>
      <PollResponder
        poll={buildPollView(poll, { kind: "member", userId: user.id }, { memberNames })}
        respondAs="member"
        orgId={org.id}
        orgSlug={orgSlug}
        canFinalize={canFinalize}
        actions={
          canDelete ? (
            <DeletePollButton
              orgId={org.id}
              orgSlug={orgSlug}
              pollId={poll.id}
              title={poll.title}
              scheduled={Boolean(poll.finalizedEventId)}
            />
          ) : undefined
        }
        aside={isOpen ? <SharePollLink url={appUrl(`/poll/${poll.id}`)} /> : undefined}
      />
    </div>
  );
}
