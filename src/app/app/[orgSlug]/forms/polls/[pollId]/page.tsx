import { BackLink } from "@/components/back-link";
import { notFound, redirect } from "next/navigation";

import { QuestionPoll } from "@/components/calendar/question-poll-view";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { buildQuestionPollView } from "@/lib/polls/question-poll";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadQuestionPollSource } from "@/server/polls/question-polls";
import { planGate } from "@/server/billing/plan-gate";

/**
 * One question poll (a members' quick poll), under Forms. A find-a-time
 * poll's id (old links said /polls/ for both) goes on to its page under
 * Find a time.
 */
export default async function PollDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/forms/polls/[pollId]">) {
  const { orgSlug, pollId } = await params;
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const timePoll = await db.availabilityPoll.count({
      where: { id: pollId, organizationId: org.id },
    });
    if (timePoll > 0) return { kind: "availability" as const };
    // Moved into Forms: its page is the form's now.
    const moved = await db.poll.findFirst({
      where: { id: pollId, organizationId: org.id },
      select: { formId: true },
    });
    if (moved?.formId) return { kind: "moved" as const, formId: moved.formId };
    const question = await loadQuestionPollSource(db, org.id, pollId, user.id);
    if (!question) return null;
    const me = await db.user.findUnique({
      where: { id: user.id },
      select: { name: true, image: true, avatar: true },
    });
    // The turnout meter: one tick per member who could vote.
    const memberCount = await db.membership.count({ where: { organizationId: org.id } });
    return { kind: "question" as const, question, me, memberCount };
  });
  if (!loaded) notFound();
  if (loaded.kind === "availability") redirect(`/app/${orgSlug}/calendar/find-a-time/${pollId}`);
  if (loaded.kind === "moved") redirect(`/app/${orgSlug}/forms/${loaded.formId}`);

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
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href={`/app/${orgSlug}/forms`} label="Forms" />
      <QuestionPoll
        poll={view}
        orgId={org.id}
        orgSlug={orgSlug}
        timeZone={safeTimeZone(org.timezone)}
        memberCount={loaded.memberCount}
      />
    </div>
  );
}
