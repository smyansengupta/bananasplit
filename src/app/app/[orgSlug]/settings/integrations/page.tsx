import { ArrowUpRight, ChevronRight, Info, TriangleAlert } from "@/components/icons";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { PROVIDERS } from "@/server/integrations/catalog";
import { loadIntegrations } from "@/server/integrations/service";
import { planGate } from "@/server/billing/plan-gate";

import { SettingsIconChip } from "../settings-icon-chip";
import { SettingsNoAccess } from "../settings-no-access";
import { PROVIDER_ICONS, STATUS_COPY, statusVariant } from "./status-copy";

const MAIL_ROUTING_COPY = {
  org: "Org email goes out from your own verified sender.",
  "platform-fallback":
    "Org email goes out from the platform's no-reply address, the same sender as sign-in email. Nothing to set up; an email sender is optional.",
  none: "Org email is off: members get in-app notifications only.",
} as const;

/**
 * Settings > Integrations (OWNER/ADMIN): one row per integration with its
 * status and the last four characters of its key. Keys are write-only.
 */
export default async function IntegrationsSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "integrations.view")) {
    return <SettingsNoAccess title="Integrations" who="owners and admins" />;
  }

  const [dtos, routing] = [
    await loadIntegrations(organization.id),
    await resolveOrgMailRouting(organization.id),
  ];
  const byProvider = new Map(dtos.map((d) => [d.provider, d]));
  const connected = dtos.filter((d) => d.status === "CONNECTED").length;
  const broken = dtos.filter((d) => d.status === "ERROR" || d.status === "NEEDS_REAUTH").length;
  const summary = [
    `${connected} of ${PROVIDERS.length} connected`,
    broken > 0 ? `${broken} need${broken === 1 ? "s" : ""} attention` : null,
    routing.mode === "org"
      ? "email from your own sender"
      : routing.mode === "none"
        ? "email off"
        : "email from the platform sender",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-3xl space-y-7.5">
      <PageHeader
        title="Integrations"
        description={summary}
        actions={
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/setup/status`}>Connection status</Link>
          </Button>
        }
      />

      <div className="space-y-4.5">
        <Card className="flex-row flex-wrap items-center gap-4 px-6">
          <SettingsIconChip icon="Plug" size="md" />
          <div className="min-w-0 flex-1 basis-64">
            <p className="heading text-[15px]">Setting these up for the first time?</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              The guided setup takes them one at a time, with where to find each credential and a
              test that says what to change when it fails. This page stays here for changing one
              later.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/setup`}>
              Guided setup
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </Card>

        <p
          role="status"
          className={
            routing.mode === "none"
              ? "bg-muted/60 rounded-tile flex gap-2.5 p-3 text-sm"
              : "bg-tint-info text-tint-info-foreground rounded-tile flex gap-2.5 p-3 text-sm"
          }
        >
          {routing.mode === "none" ? (
            <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <span>{MAIL_ROUTING_COPY[routing.mode]}</span>
        </p>

        <Card className="gap-0 px-3 py-3">
          <ul className="divide-border/70 divide-y">
            {PROVIDERS.map((p) => {
              const dto = byProvider.get(p.provider)!;
              return (
                <li key={p.provider} className="py-1 first:pt-0 last:pb-0">
                  <Link
                    href={`/app/${orgSlug}/settings/integrations/${p.segment}`}
                    className="group/row hover:bg-muted/60 rounded-field focus-visible:outline-foreground flex items-center gap-3.5 px-3 py-3 transition-colors outline-none focus-visible:outline-2"
                  >
                    <SettingsIconChip icon={PROVIDER_ICONS[p.provider]} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{p.label}</p>
                      <p className="text-muted-foreground mt-0.5 text-[13px]">{p.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      {dto.last4 && (
                        <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
                          •••• {dto.last4}
                        </span>
                      )}
                      <Badge variant={statusVariant(dto.status)}>{STATUS_COPY[dto.status]}</Badge>
                      <ChevronRight
                        className="text-muted-foreground size-4 transition-transform group-hover/row:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="text-muted-foreground px-1 text-[13px]">
          Each integration uses this club&apos;s own keys, stored encrypted and never shown
          again after saving. Owners and admins can connect and test; only owners can remove.
        </p>
      </div>
    </div>
  );
}
