import { redirect } from "next/navigation";

/** "Ask a question" is Forms' quick poll now. */
export default async function AskQuestionPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls/ask">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/forms/new?poll=1`);
}
