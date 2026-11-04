import { redirect } from "next/navigation";

import { crmSettingsHref } from "@/lib/crm/settings-sections";

import { crmShell } from "../shell";

/**
 * Handover is part of CRM settings now (docs/features/crm.md, "Redesign"):
 * handing people over is its own section, Hand people over (owners, admins
 * and CRM managers), and the brief on people handed to you (?for=me) or
 * that your position looks after (?role=) is in You. Whoever can't open
 * Hand people over lands on You. A Personal space has nobody to hand over
 * to, so it goes to People.
 */
export default async function HandoverPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/handover">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (shell.access.personal) redirect(`/app/${orgSlug}/crm/people`);
  if (sp.role) redirect(crmSettingsHref(orgSlug, "you", `?role=${encodeURIComponent(sp.role)}`));
  if (sp.for === "me" || !shell.access.manager) redirect(crmSettingsHref(orgSlug, "you"));
  redirect(crmSettingsHref(orgSlug, "handover"));
}
