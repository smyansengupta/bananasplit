import { Info } from "@/components/icons";

import { platformNoReplyAddress, resolveOrgMailRouting } from "@/server/email/mailer";
import { planGate } from "@/server/billing/plan-gate";

import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader, SetupHelp } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { EmailSenderForm } from "../provider-forms";

/**
 * Settings > Integrations > Email sender (Resend), which is optional: email
 * already works with nothing set up, from the platform's no-reply address
 * (the sender sign-in mail uses). This is for a club that wants mail to come
 * from its own domain: from name, from address, reply-to and the API key;
 * the domain check; Send test email.
 */
export default async function EmailIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations/email">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const page = await loadIntegrationPage(orgSlug, "EMAIL_RESEND");
  if (!page) return <SettingsNoAccess title="Email sender" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;
  const routing = await resolveOrgMailRouting(organization.id);
  const domainStatus = typeof dto.config.domainStatus === "string" ? dto.config.domainStatus : null;

  return (
    <div className="max-w-3xl space-y-7.5">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Email sender"
        dto={dto}
        description="Optional. Task assignments, @mentions, reminders and digests already go out by email with nothing to set up. Connect your own domain here only if you want them to come from your address instead."
      />
      <div className="space-y-4.5">
        <p
          role="status"
          className="bg-tint-info text-tint-info-foreground rounded-tile flex gap-2.5 p-3 text-sm"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {routing.mode === "org"
              ? "Notification email goes out from your own sender."
              : `Notification email goes out from ${platformNoReplyAddress()} as “${organization.name} via Bananasplit”, the same sender as sign-in email. Nothing to set up.`}
            {domainStatus && domainStatus !== "verified"
              ? ` Your domain is ${domainStatus.replace(/_/g, " ")} in Resend.`
              : ""}
          </span>
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
            name="the email sender"
            canTest={canWrite}
            canRemove={canRemove}
            testLabel="Check domain"
            removeCopy="The key is deleted and email goes back to the platform's no-reply sender."
          />
        )}
        <SetupHelp title="How to set up a sending domain">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>In Resend, add your domain (for example mail.yourclub.org) under Domains.</li>
            <li>
              Add the SPF, DKIM and return-path records Resend lists at your DNS host (for a
              Netlify-managed domain: Netlify &gt; Domains &gt; DNS records), plus a DMARC record.
            </li>
            <li>When Resend shows the domain as verified, create an API key and save it here.</li>
            <li>Use a from address on that domain, then press &ldquo;Check domain&rdquo;.</li>
          </ol>
        </SetupHelp>
      </div>
    </div>
  );
}
