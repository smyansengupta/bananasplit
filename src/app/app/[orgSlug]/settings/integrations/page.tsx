import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { PROVIDERS } from "@/server/integrations/catalog";
import { loadIntegrations } from "@/server/integrations/service";

import { SettingsNoAccess } from "../settings-no-access";
import { StatusBadge } from "./integration-ui";

const MAIL_ROUTING_COPY = {
  org: "Org email goes out from your own verified sender.",
  "platform-fallback":
    "Org email goes out from the platform sender on your behalf until your own sender is connected.",
  none: "Org email is off: members get in-app notifications only. Connect an email sender to turn it on.",
} as const;

/**
 * Settings > Integrations (OWNER/ADMIN): one row per integration with its
 * status and the last four characters of its key. Keys are write-only.
 */
export default async function IntegrationsSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "integrations.view")) {
    return <SettingsNoAccess title="Integrations" who="owners and admins" />;
  }

  const [dtos, routing] = [
    await loadIntegrations(organization.id),
    await resolveOrgMailRouting(organization.id),
  ];
  const byProvider = new Map(dtos.map((d) => [d.provider, d]));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground text-sm">
          Each integration uses this organization&apos;s own keys, stored encrypted and never shown
          again after saving. Owners and admins can connect and test; only owners can remove.
        </p>
      </div>
      <p
        role="status"
        className={
          routing.mode === "none"
            ? "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            : "bg-muted rounded-md p-3 text-sm"
        }
      >
        {MAIL_ROUTING_COPY[routing.mode]}
      </p>
      <ul className="divide-y rounded-lg border">
        {PROVIDERS.map((p) => {
          const dto = byProvider.get(p.provider)!;
          return (
            <li key={p.provider}>
              <Link
                href={`/app/${orgSlug}/settings/integrations/${p.segment}`}
                className="hover:bg-accent/50 focus-visible:ring-ring flex flex-wrap items-center justify-between gap-3 p-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-muted-foreground text-xs">{p.description}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {dto.last4 && (
                    <span className="text-muted-foreground font-mono">•••• {dto.last4}</span>
                  )}
                  <StatusBadge status={dto.status} />
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
