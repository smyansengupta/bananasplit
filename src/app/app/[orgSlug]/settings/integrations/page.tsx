import { Plug } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import type { IntegrationProvider } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";

import { SettingsNoAccess } from "../settings-no-access";

const PROVIDERS: { provider: IntegrationProvider; label: string; description: string }[] = [
  {
    provider: "EMAIL_RESEND",
    label: "Email sender",
    description: "Resend, for task and notification email.",
  },
  { provider: "CLAUDE", label: "Claude API", description: "Reads uploaded org charts." },
  {
    provider: "GOOGLE_CALENDAR",
    label: "Google Calendar",
    description: "Mirrors events to your calendars.",
  },
  {
    provider: "SUPABASE_SOURCE",
    label: "Website data",
    description: "Syncs check-ins, signups and ballots.",
  },
  {
    provider: "NETLIFY_BUILD_HOOK",
    label: "Website build hook",
    description: "Rebuilds the site when public events change.",
  },
];

const MAIL_ROUTING_COPY = {
  org: "Org email goes out from your own verified sender.",
  "platform-fallback":
    "Org email goes out from the platform sender on your behalf until your own sender is connected.",
  none: "Org email is off: members get in-app notifications only. Connect an email sender to turn it on.",
} as const;

function statusLabel(status: string | undefined): string {
  if (!status) return "Not set up";
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Settings > Integrations (stub). Read-only status, never secrets: the status
 * and the last four characters only. The Settings builder adds connect, test
 * and remove on top of src/server/secrets.
 */
export default async function IntegrationsSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "integrations.view")) {
    return <SettingsNoAccess title="Integrations" who="owners and admins" />;
  }

  const integrations = await withOrgTx(organization.id, ({ db }) =>
    db.orgIntegration.findMany({
      where: { organizationId: organization.id },
      select: { provider: true, status: true, secretLast4: true },
    }),
  );
  const routing = await resolveOrgMailRouting(organization.id);
  const byProvider = new Map(integrations.map((i) => [i.provider, i]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
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
        {PROVIDERS.map(({ provider, label, description }) => {
          const row = byProvider.get(provider);
          return (
            <li key={provider} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-muted-foreground text-xs">{description}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {row?.secretLast4 && (
                  <span className="text-muted-foreground font-mono">••••{row.secretLast4}</span>
                )}
                <Badge variant={row?.status === "CONNECTED" ? "default" : "secondary"}>
                  {statusLabel(row?.status)}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
      <EmptyState
        icon={Plug}
        title="Connecting integrations is coming soon"
        description="Keys are stored encrypted and are never shown again after saving."
      />
    </div>
  );
}
