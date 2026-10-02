import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PollResponder } from "@/components/calendar/poll-responder";
import { QuestionPoll } from "@/components/calendar/question-poll-view";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { buildPollView } from "@/lib/polls/poll-view";
import { buildQuestionPollView } from "@/lib/polls/question-poll";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadQuestionPollSource } from "@/server/polls/question-polls";

import { getPollSource } from "../../queries";
import { DeletePollButton } from "./poll-actions";
import { SharePollLink } from "./share-poll-link";

/**
 * One poll, of either kind: an availability poll (find a time) when the id
 * is one, else a question poll; nothing else is a poll.
 */
export default async function PollDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/[pollId]">) {
  const { orgSlug, pollId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const poll = await getPollSource(db, org.id, pollId);
    if (!poll) {
      const question = await loadQuestionPollSource(db, org.id, pollId, user.id);
      if (!question) return null;
      const me = await db.user.findUnique({
        where: { id: user.id },
        select: { name: true, image: true, avatar: true },
      });
      return { kind: "question" as const, question, me };
    }
    // Members see each other by name inside the app (they already do on
    // event pages); only current members, and never on the public link.
    const userIds = [...new Set(poll.responses.flatMap((r) => (r.userId ? [r.userId] : [])))];
    const members = userIds.length
      ? await db.membership.findMany({
          where: { organizationId: org.id, userId: { in: userIds } },
          select: { user: { select: { id: true, name: true } } },
        })
      : [];
    return {
      kind: "availability" as const,
      poll,
      memberNames: new Map(members.map((m) => [m.user.id, m.user.name ?? ""])),
    };
  });
  if (!loaded) notFound();

  const backLink = (
    <Link
      href={`/app/${orgSlug}/calendar/polls`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Polls
    </Link>
  );

  if (loaded.kind === "question") {
    const view = buildQuestionPollView(
      loaded.question,
      {
        userId: user.id,
        isAdmin: can({ role }, "events.write"),
        profile: loaded.me ?? { name: user.name ?? null, image: null, avatar: null },
      },
      new Date(),
    );
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {backLink}
        <QuestionPoll
          poll={view}
          orgId={org.id}
          orgSlug={orgSlug}
          timeZone={safeTimeZone(org.timezone)}
        />
      </div>
    );
  }

  const { poll, memberNames } = loaded;
  // Finalizing creates an event, which is ADMIN+ (the event service).
  const canFinalize = can({ role }, "events.write");
  const canDelete = poll.createdById === user.id || canFinalize;
  const isOpen = !poll.finalizedEventId && !(poll.closesAt && poll.closesAt < new Date());

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {backLink}
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
