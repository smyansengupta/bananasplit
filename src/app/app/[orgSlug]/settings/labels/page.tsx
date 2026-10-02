import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";
import { LabelForm } from "./label-form";
import { LabelRow } from "./label-row";

export default async function LabelsPage({ params }: PageProps<"/app/[orgSlug]/settings/labels">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "labels.write")) {
    return <SettingsNoAccess title="Labels" who="owners and admins" />;
  }

  const labels = await withOrgTx(organization.id, ({ db }) =>
    db.label.findMany({
      where: { organizationId: organization.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Labels</h1>
        <p className="text-muted-foreground text-sm">
          Shared across every task in this organization.
        </p>
      </div>

      <LabelForm orgId={organization.id} />

      <div className="space-y-2">
        {labels.length === 0 ? (
          <p className="text-muted-foreground text-sm">No labels yet.</p>
        ) : (
          labels.map((label) => <LabelRow key={label.id} orgId={organization.id} label={label} />)
        )}
      </div>
    </div>
  );
}
