import { redirect } from "next/navigation";

import { crmRecordHref } from "@/lib/crm/href";

/** A person opens as a card over People now (?open=person:<id>); old links land there. */
export default async function CrmPersonPage({ params }: PageProps<"/app/[orgSlug]/crm/people/[personId]">) {
  const { orgSlug, personId } = await params;
  redirect(crmRecordHref(orgSlug, "person", personId));
}
