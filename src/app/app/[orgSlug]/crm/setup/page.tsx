import { redirect } from "next/navigation";

import { CrmSetup } from "@/components/crm/setup";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { bringInCounts } from "@/server/crm/bring-in";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Set up the CRM" };

/**
 * The one-step setup (docs/features/crm.md): what the organization mostly
 * reaches out to, then the people Bananasplit already knows. Owners and
 * admins only; run again later to add more pipelines.
 */
export default async function CrmSetupPage({ params }: PageProps<"/app/[orgSlug]/crm/setup">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug, { setup: true });
  if (!shell) return gate;
  if (!shell.access.admin) redirect(`/app/${orgSlug}/crm`);
  const counts = shell.access.settings
    ? await withOrgTx(shell.org.id, ({ db }) => bringInCounts(db, shell.org.id))
    : null;
  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/crm`} label="CRM" />
        <PageHeader
          title={shell.access.settings ? "Bring people in" : "Set up the CRM"}
          description={
            shell.access.settings
              ? "Add more of what you reach out to, or bring in the people Bananasplit already knows."
              : "One question, and the pipelines, lists and fields are made for you."
          }
        />
      </div>
      <CrmSetup
        orgId={shell.org.id}
        orgSlug={orgSlug}
        done={Boolean(shell.access.settings)}
        picked={shell.access.settings?.setupKinds ?? []}
        counts={counts}
        pipelines={shell.pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.length }))}
      />
    </div>
  );
}
