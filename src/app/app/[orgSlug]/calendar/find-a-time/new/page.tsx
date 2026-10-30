import { getOrgContextBySlug } from "@/server/db/context";
import { PollForm } from "@/components/calendar/poll-form";
import { planGate } from "@/server/billing/plan-gate";

export default async function NewFindATimePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/find-a-time/new">) {
  const { orgSlug } = await params;
  // The meeting form's "Don't know yet, find a time" carries its title here.
  const { title } = await searchParams;
  const defaultTitle = (Array.isArray(title) ? title[0] : title)?.slice(0, 200) ?? "";
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const { organization: org } = await getOrgContextBySlug(orgSlug);
  return (
    <PollForm
      orgId={org.id}
      orgSlug={orgSlug}
      defaultTimezone={org.timezone}
      defaultTitle={defaultTitle}
    />
  );
}
