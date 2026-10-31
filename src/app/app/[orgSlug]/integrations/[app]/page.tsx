import { redirect } from "next/navigation";

/**
 * The old setup pages (/integrations/email, /integrations/google-calendar,
 * …): each app now opens in a window on the Integrations page, so the old
 * URL opens that window, keeping its query (Google's ?google=connected).
 */
export default async function IntegrationMoved({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/integrations/[app]">) {
  const { orgSlug, app } = await params;
  const query = new URLSearchParams({ app });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string" && key !== "app") query.set(key, value);
  }
  redirect(`/app/${orgSlug}/integrations?${query}`);
}
