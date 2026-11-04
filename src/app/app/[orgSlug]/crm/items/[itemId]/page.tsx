import { redirect } from "next/navigation";

import { crmRecordHref } from "@/lib/crm/href";

/** A deal opens as a card over Deals now (?open=deal:<id>); old links land there. */
export default async function CrmItemPage({ params }: PageProps<"/app/[orgSlug]/crm/items/[itemId]">) {
  const { orgSlug, itemId } = await params;
  redirect(crmRecordHref(orgSlug, "deal", itemId));
}
