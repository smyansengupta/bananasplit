import { getOrgContextBySlug } from "@/server/db/context";
import { PollForm } from "@/components/calendar/poll-form";
import { getOrgMembersForPicker } from "@/server/members";
import { planGate } from "@/server/billing/plan-gate";

export default async function NewFindATimePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/find-a-time/new">) {
  const { orgSlug } = await params;
  // The meeting form's "Don't know yet, find a time" carries its title and
  // the people it was going to invite (?ask=id,id) here.
  const { title, ask } = await searchParams;
  const defaultTitle = (Array.isArray(title) ? title[0] : title)?.slice(0, 200) ?? "";
  const askParam = (Array.isArray(ask) ? ask[0] : ask) ?? "";
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const { organization: org } = await getOrgContextBySlug(orgSlug);
  const members = org.kind === "PERSONAL" ? [] : await getOrgMembersForPicker(org.id);
  const known = new Set(members.map((m) => m.id));
  const defaultAskIds = askParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => known.has(id))
    .slice(0, 200);
  return (
    <PollForm
      orgId={org.id}
      orgSlug={orgSlug}
      defaultTimezone={org.timezone}
      defaultTitle={defaultTitle}
      members={members}
      defaultAskIds={defaultAskIds}
    />
  );
}
