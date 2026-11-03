import { redirect } from "next/navigation";

import { crmRecordHref } from "@/lib/crm/href";

/** A company opens as a card over People's Companies now (?open=company:<id>); old links land there. */
export default async function CrmCompanyPage({ params }: PageProps<"/app/[orgSlug]/crm/companies/[companyId]">) {
  const { orgSlug, companyId } = await params;
  redirect(crmRecordHref(orgSlug, "company", companyId));
}
