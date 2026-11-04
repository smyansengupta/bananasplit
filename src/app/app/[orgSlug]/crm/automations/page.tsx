import { redirect } from "next/navigation";

/** Automations moved into CRM settings; ?view= (recipes, scoring) comes along. */
export default async function CrmAutomationsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/automations">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const view = sp.view === "recipes" || sp.view === "scoring" ? `?view=${sp.view}` : "";
  redirect(`/app/${orgSlug}/crm/settings/automations${view}`);
}
