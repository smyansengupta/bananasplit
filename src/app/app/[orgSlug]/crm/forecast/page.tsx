import { redirect } from "next/navigation";

/** Forecast and goals live in the Deals report now (goals on Today); old links land there. */
export default async function CrmForecastPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/forecast">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const pipeline = typeof sp.pipeline === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sp.pipeline) ? sp.pipeline : null;
  redirect(`/app/${orgSlug}/crm/reports${pipeline ? `/deals/${pipeline}` : ""}`);
}
