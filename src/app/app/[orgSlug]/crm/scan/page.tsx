import { redirect } from "next/navigation";

import { hrefWithOpen } from "@/lib/crm/overlay";

/** Scanning a card is part of New person now: the New card reads a photo and fills itself in. */
export default async function CrmScanPage({ params }: PageProps<"/app/[orgSlug]/crm/scan">) {
  const { orgSlug } = await params;
  redirect(hrefWithOpen(`/app/${orgSlug}/crm/people`, "", { kind: "new", what: "person" }));
}
