import { redirect } from "next/navigation";

import { crmPlanHref } from "@/lib/crm/href";

/** A sequence opens as its card over CRM settings > Automations (?open=plan:sequence:<id>). */
export default async function SequencePage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/sequences/[sequenceId]">) {
  const { orgSlug, sequenceId } = await params;
  redirect(crmPlanHref(orgSlug, "sequence", sequenceId));
}
