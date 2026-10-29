import { redirect } from "next/navigation";

import { clubRoleHref } from "@/lib/onboarding/steps";

/** The old "Your role" address: on to your profile in the organization. */
export default async function JoinedPage({ params }: PageProps<"/onboarding/join/[orgSlug]">) {
  const { orgSlug } = await params;
  redirect(clubRoleHref(orgSlug));
}
