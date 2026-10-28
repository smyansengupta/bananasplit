import { CalendarClock, Plus, Vote } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PollList } from "@/components/polls/poll-list";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { sectionLabel } from "@/lib/nav/sidebar";
import { isPollOpen } from "@/lib/polls/question-poll";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listQuestionPolls } from "@/server/polls/question-polls";
import { planGate } from "@/server/billing/plan-gate";

import { questionItem } from "./poll-items";

/**
 * The club's question polls, newest first, split into open and closed.
 * Finding a meeting time has its own section (Find a time).
 */
export default async function PollsListPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;

  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const questions = await withOrgTx(org.id, ({ db }) => listQuestionPolls(db, org.id));
  const now = new Date();
  const isAdmin = can({ role }, "events.write");
  const base = `/app/${orgSlug}`;
  const timeZone = safeTimeZone(org.timezone);

  const all = [...questions]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((p) => ({
      open: isPollOpen(p, now),
      item: questionItem(p, base, now, timeZone, p.createdById === user.id || isAdmin),
    }));

  const openCount = all.filter((p) => p.open).length;
  const votes = questions.filter((p) => isPollOpen(p, now)).reduce((n, p) => n + p.voterCount, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "polls")}
        description={
          <>
            {all.length > 0
              ? `${openCount} open · ${votes === 1 ? "1 person" : `${votes} people`} voted so far. `
              : "Ask the organization a question and let people vote. "}
            Picking a meeting time?{" "}
            <Link
              href={`${base}/calendar/find-a-time`}
              className="text-foreground underline underline-offset-2"
            >
              Find a time
            </Link>
            .
          </>
        }
        actions={
          <Button variant="create" asChild>
            <Link href={`${base}/calendar/polls/ask`}>
              <Plus aria-hidden className="size-4" />
              Ask a question
            </Link>
          </Button>
        }
      />

      {all.length === 0 ? (
        // Ask a question is in the header; this points at the other kind of poll.
        <EmptyState
          icon={Vote}
          title="No polls yet"
          description="Ask a question, give a few options, and let the organization vote: where to eat, which date, who should run the table."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={`${base}/calendar/find-a-time`}>
                <CalendarClock aria-hidden className="size-4" />
                Find a meeting time instead
              </Link>
            </Button>
          }
        />
      ) : (
        <PollList
          orgId={org.id}
          open={all.filter((p) => p.open).map((p) => p.item)}
          closed={all.filter((p) => !p.open).map((p) => p.item)}
        />
      )}
    </div>
  );
}
