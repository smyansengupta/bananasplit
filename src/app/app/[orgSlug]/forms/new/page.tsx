import { QuestionPollForm } from "@/components/calendar/question-poll-form";
import { BackLink } from "@/components/back-link";
import { TemplateRow } from "@/components/forms/new-form";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Start something in Forms: `?poll=1` is a quick poll (any member); without
 * it, owners and admins pick a template, which makes the form and opens it.
 */
export default async function NewFormPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/forms/new">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);
  const canMake = can({ role }, "databases.write");
  if (sp.poll === "1" || !canMake) {
    const question = typeof sp.question === "string" ? sp.question.slice(0, 300) : "";
    return (
      <QuestionPollForm
        orgId={org.id}
        orgSlug={orgSlug}
        canMakeForms={canMake}
        initialQuestion={question}
      />
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/forms`} label="Forms" />
        <PageHeader title="New form" />
      </div>
      <TemplateRow orgId={org.id} orgSlug={orgSlug} withBlank />
    </div>
  );
}
