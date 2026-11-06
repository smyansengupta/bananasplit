import { redirect } from "next/navigation";

import { outreachRedirectHref } from "@/lib/crm/redirects";

/** One email to a list opens over People now, with the list (?open=plan:email&to=). */
export default async function BulkPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/outreach/bulk">) {
  const { orgSlug } = await params;
  redirect(
    outreachRedirectHref(orgSlug, "bulk", (await searchParams) as Record<string, string | string[] | undefined>),
  );
}
