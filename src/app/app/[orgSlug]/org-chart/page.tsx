import { redirect } from "next/navigation";

/**
 * The org chart is People's Org chart view now (?view=chart). Old links
 * and pins land there, keeping an open position (?position=).
 */
export default async function OrgChartPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/org-chart">) {
  const { orgSlug } = await params;
  const { position } = await searchParams;
  const key = typeof position === "string" ? position : null;
  redirect(
    `/app/${orgSlug}/people?view=chart${key ? `&position=${encodeURIComponent(key)}` : ""}`,
  );
}
