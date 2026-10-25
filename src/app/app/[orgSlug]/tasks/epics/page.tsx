import { redirect } from "next/navigation";

/**
 * Epics live in the task workspace now, as the layout that used to be called
 * Roadmap: the timeline, and the epic cards under it. The old path still
 * works, because it is in people's bookmarks and in links they have shared.
 */
export default async function EpicsMoved({ params }: PageProps<"/app/[orgSlug]/tasks/epics">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/tasks?view=roadmap`);
}
