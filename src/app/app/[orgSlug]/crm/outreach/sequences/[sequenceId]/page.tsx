import { redirect } from "next/navigation";

import { crmPlanHref } from "@/lib/crm/href";

/** A sequence opens as its plan card over Outreach now (?open=plan:sequence:<id>). */
export default async function SequencePage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/sequences/[sequenceId]">) {
  const { orgSlug, sequenceId } = await params;
  redirect(crmPlanHref(orgSlug, "sequence", sequenceId));
}
