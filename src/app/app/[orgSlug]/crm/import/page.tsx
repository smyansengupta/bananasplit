import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmToolbar } from "@/components/crm/chrome/crm-toolbar";
import { Importer, type TargetOption } from "@/components/crm/importer";
import { RowsToFix } from "@/components/crm/settings/import-settings";
import { builtinFields, type CrmObject } from "@/lib/crm/fields";
import { customFieldsFor } from "@/server/crm/databases";
import { importsToFix, recentImports } from "@/server/crm/import";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Import" };

/**
 * Import a file into the CRM, or turn one of the organization's databases
 * into records. A page, not a card: matching a sheet's columns needs the
 * room. It wears the CRM's own header and tab switch (People stays lit).
 * Any member can import, so the rows their own imports couldn't bring in
 * are here too, each with its fix (the Inbox line for a file with skipped
 * rows opens this page).
 */
export default async function CrmImportPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/import">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const pipelineId = shell.pipelines.find((p) => p.id === sp.pipeline)?.id ?? null;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const targets = {} as Record<CrmObject, TargetOption[]>;
    for (const object of ["person", "company", "deal"] as const) {
      const custom = await customFieldsFor(db, orgId, object, object === "deal" ? (pipelineId ?? shell.pipelines[0]?.id) : null);
      targets[object] = [
        ...builtinFields(object)
          .filter((f) => f.importable)
          .map((f) => ({ value: f.key, label: f.label })),
        ...custom.filter((f) => f.type !== "RELATION").map((f) => ({ value: `custom:${f.id}`, label: f.name })),
      ];
    }
    const databases = shell.access.admin
      ? await db.databaseDefinition.findMany({
          where: { organizationId: orgId, kind: "CUSTOM", archivedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [];
    return {
      targets,
      databases,
      recent: await recentImports(db, orgId, shell.user.id),
      fix: await importsToFix(db, orgId, shell.user.id),
    };
  });
  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        title="Import"
        create={false}
        toolbar={<CrmToolbar tabs={shell.tabs} />}
      />
      <p className="text-muted-foreground -mt-3 mb-6 max-w-prose text-[15px]">
        People, companies or deals from a spreadsheet, a phone&apos;s contacts, or the CRM you&apos;re leaving.
      </p>
      {data.fix.length > 0 && (
        <div className="mb-8 space-y-4">
          {data.fix.map((f) => (
            <RowsToFix
              key={f.id}
              orgId={orgId}
              item={{ id: f.id, fileName: f.fileName, done: f.created + f.updated, rows: f.rows }}
            />
          ))}
        </div>
      )}
      <Importer
        orgId={orgId}
        orgSlug={orgSlug}
        targets={data.targets}
        pipelines={shell.pipelines.map((p) => ({ id: p.id, name: p.name }))}
        databases={data.databases}
        initialPipeline={pipelineId}
        recent={data.recent.map((r) => ({
          id: r.id,
          fileName: r.fileName,
          status: r.status,
          total: r.total,
          done: r.done,
          created: r.created,
          updated: r.updated,
          skipped: r.skipped,
          activities: r.activities,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
