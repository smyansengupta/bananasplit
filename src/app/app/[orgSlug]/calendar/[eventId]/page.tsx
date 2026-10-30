import { redirect } from "next/navigation";

/**
 * An event has one page: its meeting page (/meetings/{id}), which has
 * everything this one had plus the join card, reminders and the map. This
 * address stays for old links (notifications, emails, the website, pins)
 * and sends them there, keeping `?edit=1`.
 */
export default async function EventDetailPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]">) {
  const { orgSlug, eventId } = await params;
  const { edit } = await searchParams;
  const editing = (Array.isArray(edit) ? edit[0] : edit) === "1";
  redirect(`/app/${orgSlug}/meetings/${eventId}${editing ? "?edit=1" : ""}`);
}
