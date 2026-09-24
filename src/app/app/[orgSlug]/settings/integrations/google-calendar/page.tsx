import {
  GOOGLE_CALLBACK_MESSAGES,
  type GoogleCallbackError,
} from "@/server/integrations/google-connect";
import { isGoogleConfigured } from "@/server/integrations/google";

import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { GoogleCalendarPanel } from "../provider-forms";

const EXTRA_MESSAGES: Record<string, string> = {
  connected: "Google Calendar is connected. Choose the calendars to mirror events to.",
  rate_limited: "Too many connection attempts. Try again in an hour.",
};

/**
 * Settings > Integrations > Google Calendar: connect (OAuth with PKCE and a
 * signed state), choose calendars, test, disconnect (OWNER/ADMIN) and remove
 * (OWNER). The refresh token is an encrypted OrgSecret; the page shows only
 * its last four characters.
 */
export default async function GoogleCalendarIntegrationPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/settings/integrations/google-calendar">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const page = await loadIntegrationPage(orgSlug, "GOOGLE_CALENDAR");
  if (!page) return <SettingsNoAccess title="Google Calendar" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;
  const code = typeof sp.google === "string" ? sp.google : null;
  const notice = code
    ? (EXTRA_MESSAGES[code] ?? GOOGLE_CALLBACK_MESSAGES[code as GoogleCallbackError] ?? null)
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Google Calendar"
        description="Events you create here are mirrored to your Google calendars, so members can subscribe in their own calendar apps. The portal stays the source of truth."
      />
      {notice && (
        <p
          role="status"
          className={
            code === "connected"
              ? "bg-muted rounded-md p-3 text-sm"
              : "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          }
        >
          {notice}
        </p>
      )}
      <StatusPanel dto={dto} secretLabel="Refresh token" />
      <GoogleCalendarPanel
        orgId={organization.id}
        dto={dto}
        canWrite={canWrite}
        configured={isGoogleConfigured()}
      />
      {dto.hasSecret && (
        <TestAndRemove
          orgId={organization.id}
          provider="GOOGLE_CALENDAR"
          canTest={canWrite && dto.status !== "DISCONNECTED"}
          canRemove={canRemove}
          testLabel="Test and refresh calendars"
          removeCopy="Access is revoked at Google and the token is deleted. Events stop mirroring; nothing already in Google is deleted."
        />
      )}
    </div>
  );
}
