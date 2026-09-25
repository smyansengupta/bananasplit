import { getOrgContextBySlug } from "@/server/db/context";
import { PollForm } from "@/components/calendar/poll-form";

export default async function NewPollPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/new">) {
  const { orgSlug } = await params;
  const { organization: org } = await getOrgContextBySlug(orgSlug);
  return <PollForm orgId={org.id} orgSlug={orgSlug} defaultTimezone={org.timezone} />;
}
