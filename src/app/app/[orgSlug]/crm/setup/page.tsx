import { redirect } from "next/navigation";

import { CrmSetup } from "@/components/crm/setup";
import { bringInCounts } from "@/server/crm/bring-in";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Set up the CRM" };

/**
 * First-time setup (docs/features/crm.md, "Redesign", Setup): what the
 * space mostly reaches out to, then bring people in, who looks after them,
 * and what to connect. Owners and admins only (in a Personal space, its
 * owner); run again later to bring more people in or add pipelines.
 */
export default async function CrmSetupPage({ params }: PageProps<"/app/[orgSlug]/crm/setup">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug, { setup: true });
  if (!shell) return gate;
  if (!shell.access.admin) redirect(`/app/${orgSlug}/crm`);
  const counts = await withOrgTx(shell.org.id, ({ db }) => bringInCounts(db, shell.org.id));
  return (
    <CrmSetup
      orgId={shell.org.id}
      orgSlug={orgSlug}
      personal={shell.access.personal}
      admin={shell.access.admin}
      done={Boolean(shell.access.settings)}
      picked={shell.access.settings?.setupKinds ?? []}
      counts={counts}
    />
  );
}
