import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { ApiKeys } from "@/components/crm/settings/api-keys";
import { Webhooks } from "@/components/crm/settings/webhooks";
import { appUrl } from "@/lib/app-url";
import { withOrgTx } from "@/server/db/context";

import type { SectionProps } from "./types";

/**
 * API and webhooks (owners and admins; RLS hides both from everyone
 * else): keys for the CRM's REST API, outgoing webhooks with their
 * delivery log, and the short how-to (the full contract is the OpenAPI
 * document).
 */
export async function ApiSection({ shell }: SectionProps) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => ({
    keys: await db.crmApiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
    hooks: await db.crmWebhook.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        deliveries: {
          orderBy: { createdAt: "desc" },
          take: 15,
          select: {
            id: true,
            event: true,
            status: true,
            attempts: true,
            responseCode: true,
            lastError: true,
            createdAt: true,
          },
        },
      },
    }),
  }));
  const base = appUrl("/api/crm/v1");
  return (
    <>
      <ApiKeys
        orgId={orgId}
        keys={data.keys.map((k) => ({
          ...k,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        }))}
      />
      <Webhooks
        orgId={orgId}
        hooks={data.hooks.map((h) => ({
          ...h,
          deliveries: h.deliveries.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
        }))}
      />
      <SettingsCard
        title="How to use it"
        description="Read and change the CRM from Zapier, Make, a spreadsheet script or your own app. A key can read and change everything, so give each tool its own."
      >
        <p className="text-sm">
          Send the key in a header:{" "}
          <code className="bg-muted rounded px-1">Authorization: Bearer bsk_…</code>. Every answer
          is JSON.
        </p>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[12px] leading-relaxed">
          {`curl ${base}/people?limit=10 \\
  -H "Authorization: Bearer $KEY"

curl -X POST ${base}/people \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Maya Chen","email":"maya@example.org"}'`}
        </pre>
        <ul className="list-disc space-y-1.5 ps-5 text-sm">
          <li>People, companies, deals, activities, and pipelines with their stages.</li>
          <li>
            Lists come newest first, 25 at a time (up to 100 with ?limit=). Pass nextCursor back as
            ?cursor= for more.
          </li>
          <li>
            PATCH a record to change it. Nothing is deleted: send trashed: true to move it to the
            trash.
          </li>
          <li>Changing a deal&apos;s stageId moves it, with the same rules as the board.</li>
          <li>Each key may make 300 requests a minute, 60 of them changes.</li>
          <li>
            Each webhook delivery carries an X-Bananasplit-Signature header: t (the time) and v1,
            the HMAC-SHA256 of t, a dot and the body under the webhook&apos;s secret.
          </li>
        </ul>
        <p className="text-sm">
          Everything, field by field:{" "}
          <a
            className="font-semibold underline-offset-2 hover:underline"
            href="/api/crm/v1/openapi.json"
            target="_blank"
            rel="noopener"
          >
            the OpenAPI document
          </a>
          . It opens in Postman, Insomnia and most API tools.
        </p>
      </SettingsCard>
    </>
  );
}
