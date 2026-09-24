import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";

import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { EmailSenderForm, MailFallbackToggle } from "../provider-forms";

const ROUTING_COPY = {
  org: "Notification email goes out from your own sender.",
  "platform-fallback":
    "Notification email goes out from the platform sender on your behalf until your sender is verified.",
  none: "Notification email is off: members get in-app notifications only.",
} as const;

/**
 * Settings > Integrations > Email sender (Resend): from name, from address,
 * reply-to and the API key; the domain check; Send test email; and the
 * OWNER's platform-fallback switch.
 */
export default async function EmailIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations/email">) {
  const { orgSlug } = await params;
  const page = await loadIntegrationPage(orgSlug, "EMAIL_RESEND");
  if (!page) return <SettingsNoAccess title="Email sender" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove, role } = page;
  const { settings } = await getOrgContextBySlug(orgSlug);
  const routing = await resolveOrgMailRouting(organization.id);
  const domainStatus = typeof dto.config.domainStatus === "string" ? dto.config.domainStatus : null;

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Email sender"
        description="Send task assignments, reminders, digests and other notifications from your own address through Resend. Invitations use it too once it is verified."
      />
      <p
        role="status"
        className={
          routing.mode === "none"
            ? "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            : "bg-muted rounded-md p-3 text-sm"
        }
      >
        {ROUTING_COPY[routing.mode]}
        {domainStatus && domainStatus !== "verified"
          ? ` Your domain is ${domainStatus.replace(/_/g, " ")} in Resend.`
          : ""}
      </p>
      <StatusPanel dto={dto} secretLabel="API key" />
      <EmailSenderForm
        orgId={organization.id}
        dto={dto}
        canWrite={canWrite}
        orgName={organization.name}
      />
      {dto.hasSecret && (
        <TestAndRemove
          orgId={organization.id}
          provider="EMAIL_RESEND"
          canTest={canWrite}
          canRemove={canRemove}
          testLabel="Check domain"
          removeCopy="The key is deleted and org email falls back to the platform sender (if the fallback is on) or in-app only."
        />
      )}
      <MailFallbackToggle
        orgId={organization.id}
        enabled={settings?.platformMailFallback ?? false}
        canEdit={can({ role }, "mail.fallback.write")}
      />
      <details className="text-muted-foreground text-sm">
        <summary className="cursor-pointer">How to set up a sending domain</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>In Resend, add your domain (for example mail.yourclub.org) under Domains.</li>
          <li>
            Add the SPF, DKIM and return-path records Resend lists at your DNS host (for a
            Netlify-managed domain: Netlify &gt; Domains &gt; DNS records), plus a DMARC record.
          </li>
          <li>When Resend shows the domain as verified, create an API key and save it here.</li>
          <li>Use a from address on that domain, then press &ldquo;Check domain&rdquo;.</li>
        </ol>
      </details>
    </div>
  );
}
