import { redirect } from "next/navigation";

/** Automations moved into CRM settings; ?view= (recipes, scoring) opens over it. */
export default async function CrmAutomationsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/automations">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const open = sp.view === "recipes" || sp.view === "scoring" ? `?open=${sp.view}` : "";
  redirect(`/app/${orgSlug}/crm/settings/automations${open}`);
}
