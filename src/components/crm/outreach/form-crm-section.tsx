import { readAddOns } from "@/lib/addons";
import { readDestination, suggestMap } from "@/lib/crm/outreach/form-map";
import { readQuestions, takesAnswer } from "@/lib/forms/questions";
import { withOrgTx } from "@/server/db/context";

import { FormCrmEditor } from "./form-crm";

/**
 * Forms to the CRM, on a form's Settings tab: only when the organization has
 * the CRM added and set up. Reads in its own transaction.
 */
export async function FormCrmSection({ orgId, formId }: { orgId: string; formId: string }) {
  const data = await withOrgTx(orgId, async ({ db }) => {
    const settings = await db.orgSettings.findUnique({ where: { organizationId: orgId }, select: { addOns: true } });
    const crm = await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { setupDoneAt: true, relationshipTypes: true } });
    if (!readAddOns(settings?.addOns).includes("crm") || !crm?.setupDoneAt) return null;
    const form = await db.form.findFirst({ where: { id: formId, organizationId: orgId }, select: { questions: true, crmDestination: true, anonymous: true } });
    if (!form || form.anonymous) return null;
    const pipelines = await db.crmPipeline.findMany({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, stages: { where: { kind: "OPEN" }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } },
    });
    const questions = readQuestions(form.questions).filter((q) => takesAnswer(q.type) && q.type !== "file" && q.type !== "image" && q.type !== "signature");
    const types = (Array.isArray(crm.relationshipTypes) ? crm.relationshipTypes : []) as { id: string; label: string }[];
    return { form, pipelines, questions, types };
  });
  if (!data) return null;
  return (
    <FormCrmEditor
      orgId={orgId}
      formId={formId}
      initial={readDestination(data.form.crmDestination)}
      suggested={suggestMap(data.questions.map((q) => ({ id: q.id, type: q.type, title: q.title, fieldId: q.fieldId })))}
      questions={data.questions.map((q) => ({ id: q.id, title: q.title }))}
      pipelines={data.pipelines}
      types={data.types.map((t) => ({ value: t.id, label: t.label }))}
    />
  );
}
