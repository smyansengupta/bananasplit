import { redirect } from "next/navigation";

/** Reports moved into Databases (a tab there); old links and bookmarks land on it. */
export default async function ReportsRedirect({ params, searchParams }: PageProps<"/app/[orgSlug]/reports">) {
  const { orgSlug } = await params;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value ? [value] : []) qs.append(key, v);
  }
  const query = qs.toString();
  redirect(`/app/${orgSlug}/databases/reports${query ? `?${query}` : ""}`);
}
