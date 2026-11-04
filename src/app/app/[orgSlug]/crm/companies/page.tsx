import { redirect } from "next/navigation";

/**
 * Companies are a view of People now (?view=companies, docs/features/crm.md,
 * "Redesign"); old links land there with their filters, and ?new=1 opens
 * the New card on New company.
 */
export default async function CrmCompaniesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/companies">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const next = new URLSearchParams({ view: "companies" });
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v !== "string" || k === "view") continue;
    if (k === "new") {
      if (v === "1") next.set("open", "new:company");
      continue;
    }
    next.set(k, v);
  }
  redirect(`/app/${orgSlug}/crm/people?${next}`);
}
