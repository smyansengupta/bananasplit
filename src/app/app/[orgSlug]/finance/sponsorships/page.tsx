import { permanentRedirect } from "next/navigation";

/** Sponsorships are Deals now: old links and pins land there. */
export default async function OldSponsorshipsPage({
  params,
}: PageProps<"/app/[orgSlug]/finance/sponsorships">) {
  const { orgSlug } = await params;
  permanentRedirect(`/app/${orgSlug}/finance/deals`);
}
