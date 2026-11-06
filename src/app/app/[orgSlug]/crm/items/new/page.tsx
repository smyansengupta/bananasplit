import { redirect } from "next/navigation";

import { newItemRedirect } from "@/lib/crm/redirects";

/** New item is the New card's Deal now (?open=new:deal); old links land there. */
export default async function NewCrmItemPage({ params }: PageProps<"/app/[orgSlug]/crm/items/new">) {
  const { orgSlug } = await params;
  redirect(newItemRedirect(orgSlug));
}
