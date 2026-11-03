import { redirect } from "next/navigation";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { ApiKeys } from "@/components/crm/settings/api-keys";
import { CrmSettingsLinks } from "@/components/crm/settings/settings-links";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { appUrl } from "@/lib/app-url";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "API keys" };

/**
 * API keys for the CRM's REST API, and the short how-to an organization
 * needs to use it (the full contract is the OpenAPI document).
 */
export default async function CrmApiPage({ params }: PageProps<"/app/[orgSlug]/crm/settings/api">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (!shell.access.admin) redirect(`/app/${orgSlug}/crm`);
  const orgId = shell.org.id;
  const keys = await withOrgTx(orgId, ({ db }) =>
    db.crmApiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    }),
  );
  const base = appUrl("/api/crm/v1");
  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys"
        description="Read and change the CRM from Zapier, Make, a spreadsheet script or your own app."
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <CrmSettingsLinks orgSlug={orgSlug} current="api" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <ApiKeys
          orgId={orgId}
          keys={keys.map((k) => ({
            ...k,
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
            revokedAt: k.revokedAt?.toISOString() ?? null,
            createdAt: k.createdAt.toISOString(),
          }))}
        />
        <Card className="h-fit gap-3 p-5 text-sm">
          <h2 className="heading text-base">How to use it</h2>
          <p>
            Send the key in a header: <code className="bg-muted rounded px-1">Authorization: Bearer bsk_…</code>. Every
            answer is JSON.
          </p>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[12px] leading-relaxed">
            {`curl ${base}/people?limit=10 \\
  -H "Authorization: Bearer $KEY"

curl -X POST ${base}/people \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Maya Chen","email":"maya@example.org"}'`}
          </pre>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>People, companies, items (pipeline items), activities, and pipelines with their stages.</li>
            <li>Lists come newest first, 25 at a time (up to 100 with ?limit=). Pass nextCursor back as ?cursor= for more.</li>
            <li>PATCH a record to change it. Nothing is deleted: send trashed: true to move it to the trash.</li>
            <li>Changing an item&apos;s stageId moves it, with the same rules as the board.</li>
            <li>Each key may make 300 requests a minute, 60 of them changes.</li>
          </ul>
          <p>
            Everything, field by field:{" "}
            <a className="font-semibold underline-offset-2 hover:underline" href="/api/crm/v1/openapi.json" target="_blank" rel="noopener">
              the OpenAPI document
            </a>
            . It opens in Postman, Insomnia and most API tools.
          </p>
          <p>
            Want changes pushed to you instead? Add a webhook. Each delivery carries an X-Bananasplit-Signature header:
            t (the time) and v1, the HMAC-SHA256 of t, a dot and the body under the webhook&apos;s secret.
          </p>
        </Card>
      </div>
    </div>
  );
}
