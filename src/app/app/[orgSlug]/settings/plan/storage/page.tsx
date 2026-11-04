import { redirect } from "next/navigation";

/** Storage moved onto the Plan page; old links land on its Storage section. */
export default async function StoragePage({
  params,
}: PageProps<"/app/[orgSlug]/settings/plan/storage">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/settings/plan#storage`);
}
