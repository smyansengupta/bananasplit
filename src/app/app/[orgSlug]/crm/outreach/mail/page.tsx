import { redirect } from "next/navigation";

/** Your mail lives on Outreach now (its Your mail round button). */
export default async function MailPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/mail">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm/outreach?view=mail`);
}
