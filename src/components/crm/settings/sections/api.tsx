import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { ApiKeys } from "@/components/crm/settings/api-keys";
import { Webhooks } from "@/components/crm/settings/webhooks";
import { appUrl } from "@/lib/app-url";
import { withOrgTx } from "@/server/db/context";

/**
 * API and webhooks (owners and admins; RLS hides both from everyone else):
 * keys for the CRM's REST API, outgoing webhooks with their delivery log,
 * and how to call it (the full contract is the OpenAPI document).
 */
export async function ApiCards({ orgId }: { orgId: string }) {
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
      <div id="api" className="scroll-mt-24">
        <ApiKeys
          orgId={orgId}
          keys={data.keys.map((k) => ({
            ...k,
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
            revokedAt: k.revokedAt?.toISOString() ?? null,
            createdAt: k.createdAt.toISOString(),
          }))}
        />
      </div>
      <div id="webhooks" className="scroll-mt-24">
        <Webhooks
          orgId={orgId}
          hooks={data.hooks.map((h) => ({
            ...h,
            deliveries: h.deliveries.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
          }))}
        />
      </div>
      <SettingsCard title="How to use the API">
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[12px] leading-relaxed">
          {`curl ${base}/people?limit=10 \\
  -H "Authorization: Bearer $KEY"`}
        </pre>
        <p className="text-sm">
          Each key may make 300 requests a minute, 60 of them changes. Each webhook delivery
          carries an X-Bananasplit-Signature header: t (the time) and v1, the HMAC-SHA256 of t, a
          dot and the body under the webhook&apos;s secret.
        </p>
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
          .
        </p>
      </SettingsCard>
    </>
  );
}
