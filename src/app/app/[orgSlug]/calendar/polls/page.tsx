import { CalendarRange } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getOrgPolls } from "../queries";

export default async function PollsListPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls">) {
  const { orgSlug } = await params;

  const { organization: org } = await getOrgContextBySlug(orgSlug);
  const polls = await withOrgTx(org.id, ({ db }) => getOrgPolls(db, org.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/app/${orgSlug}/calendar`}
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Back to calendar
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Availability polls</h1>
        </div>
        <Button asChild>
          <Link href={`/app/${orgSlug}/calendar/polls/new`}>New poll</Link>
        </Button>
      </div>

      {polls.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No polls yet"
          description="Create a when2meet-style poll to find a time that works for everyone."
        />
      ) : (
        <ul className="space-y-2">
          {polls.map((poll) => (
            <li key={poll.id}>
              <Link
                href={`/app/${orgSlug}/calendar/polls/${poll.id}`}
                className="bg-card hover:border-foreground/20 flex items-center justify-between gap-3 rounded-md border p-3 text-sm transition-colors"
              >
                <span>
                  <span className="font-medium">{poll.title}</span>
                  <span className="text-muted-foreground ml-2">
                    {poll._count.responses} response(s)
                  </span>
                </span>
                {poll.finalizedEventId && (
                  <span className="text-muted-foreground text-xs">Finalized</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
