import { redirect } from "next/navigation";

/** Projects became epics: the old Tasks > Projects link opens the Epics page. */
export default async function ProjectsPage({ params }: PageProps<"/app/[orgSlug]/tasks/projects">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/tasks?view=roadmap`);
}
