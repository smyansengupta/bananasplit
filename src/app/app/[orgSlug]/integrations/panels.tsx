import type { ReactNode } from "react";

import { SyncPanel } from "@/components/calendar/sync-panel";
import { CircleCheck, Info, TriangleAlert } from "@/components/icons";
import { VideoProviderPanel } from "@/components/integrations/video-provider-panel";
import type { IntegrationProvider } from "@/generated/prisma/enums";
import type { PlanFeature } from "@/lib/billing/features";
import { planGate } from "@/server/billing/plan-gate";
import { loadMeetingConnections } from "@/server/conference/connections";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { platformNoReplyAddress, resolveOrgMailRouting } from "@/server/email/mailer";
import { getGoogleSyncStatus } from "@/server/google-calendar/requests";
import { isGoogleConfigured } from "@/server/integrations/google";
import {
  GOOGLE_CALLBACK_MESSAGES,
  type GoogleCallbackError,
} from "@/server/integrations/google-connect";

import { SetupHelp } from "./integration-header";
import { StatusPanel, TestAndRemove } from "./integration-ui";
import { loadIntegrationPage } from "./load";
import { PHONE_APPS, phonePanel } from "./phone-panels";
import {
  AiModelForm,
  ClaudeForm,
  EmailSenderForm,
  GoogleCalendarPanel,
  NetlifyForm,
  SupabaseForm,
} from "./provider-forms";
import { integrationSummary } from "./status-copy";

/** What the Integrations window shows for one app: its title, state line and body. */
export interface Panel {
  title: string;
  summary?: string;
  body: ReactNode;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** The apps that open a window, by their `?app=` key (the old sub-page URLs). */
export const PANEL_APPS = [
  "email",
  "google-calendar",
  "claude",
  "ai-model",
  "data-source",
  "website",
  "zoom",
  "google-meet",
  "microsoft-teams",
  ...PHONE_APPS,
] as const;
export type PanelApp = (typeof PANEL_APPS)[number];

export function isPanelApp(app: unknown): app is PanelApp {
  return typeof app === "string" && (PANEL_APPS as readonly string[]).includes(app);
}

const GOOGLE_NOTICES: Record<string, string> = {
  connected: "Google Calendar is connected. Choose the calendars to mirror events to.",
  rate_limited: "Too many connection attempts. Try again in an hour.",
};

/**
 * One app's window, loaded on the server only when it's open. Null when the
 * viewer can't set integrations up (members see the page, not the windows).
 */
export async function loadPanel(
  app: PanelApp,
  orgSlug: string,
  sp: SearchParams,
): Promise<Panel | null> {
  switch (app) {
    case "zoom":
    case "google-meet":
    case "microsoft-teams":
      return videoPanel(app, orgSlug);
    case "telnyx":
    case "twilio":
    case "deepgram":
      return phonePanel(app, orgSlug);
    case "email":
      return withIntegration(orgSlug, "EMAIL_RESEND", "integrations", "Email", async (p) => {
        const { organization, dto, canWrite, canRemove } = p;
        const routing = await resolveOrgMailRouting(organization.id);
        const domainStatus =
          typeof dto.config.domainStatus === "string" ? dto.config.domainStatus : null;
        return (
          <>
            <p
              role="status"
              className="bg-tint-info text-tint-info-foreground rounded-tile flex gap-2.5 p-3 text-sm"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {routing.mode === "org"
                  ? "Email goes out from your own sender."
                  : `Email goes out from ${platformNoReplyAddress()} as “${organization.name} via Bananasplit”. Nothing to set up. Add your own domain below only if you want mail to come from your address.`}
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
                <li>In Resend, add your domain (for example mail.yourorg.com) under Domains.</li>
                <li>
                  Add the SPF, DKIM and return-path records Resend lists at your DNS host (for a
                  Netlify-managed domain: Netlify &gt; Domains &gt; DNS records), plus a DMARC
                  record.
                </li>
                <li>
                  When Resend shows the domain as verified, create an API key and save it here.
                </li>
                <li>Use a from address on that domain, then press &ldquo;Check domain&rdquo;.</li>
              </ol>
            </SetupHelp>
          </>
        );
      });
    case "google-calendar":
      return withIntegration(
        orgSlug,
        "GOOGLE_CALENDAR",
        "integrations",
        "Google Calendar",
        async (p) => {
          const { organization, dto, canWrite, canRemove } = p;
          const code = typeof sp.google === "string" ? sp.google : null;
          const notice = code
            ? (GOOGLE_NOTICES[code] ??
              GOOGLE_CALLBACK_MESSAGES[code as GoogleCallbackError] ??
              null)
            : null;
          const syncStatus =
            dto.status === "CONNECTED" || dto.status === "ERROR"
              ? await withOrgTx(organization.id, (ctx) => getGoogleSyncStatus(ctx))
              : null;
          return (
            <>
              <p className="text-muted-foreground text-sm">
                Events are mirrored to your Google calendars, so members can subscribe in their own
                calendar apps.
              </p>
              {notice && (
                <p
                  role="status"
                  className={
                    code === "connected"
                      ? "bg-tint-success text-tint-success-foreground rounded-tile flex gap-2.5 p-3 text-sm"
                      : "bg-muted/60 rounded-tile flex gap-2.5 p-3 text-sm"
                  }
                >
                  {code === "connected" ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <TriangleAlert
                      className="text-warning mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span>{notice}</span>
                </p>
              )}
              <StatusPanel dto={dto} secretLabel="Refresh token" />
              <GoogleCalendarPanel
                orgId={organization.id}
                dto={dto}
                canWrite={canWrite}
                configured={isGoogleConfigured()}
                importPanel={
                  syncStatus && (
                    <SyncPanel
                      orgId={organization.id}
                      orgSlug={orgSlug}
                      canWrite={canWrite}
                      status={syncStatus}
                      sections={["import"]}
                    />
                  )
                }
              />
              {dto.hasSecret && (
                <TestAndRemove
                  orgId={organization.id}
                  provider="GOOGLE_CALENDAR"
                  name="Google Calendar"
                  canTest={canWrite && dto.status !== "DISCONNECTED"}
                  canRemove={canRemove}
                  testLabel="Test and refresh calendars"
                  removeCopy="Access is revoked at Google and the token is deleted. Events stop mirroring; nothing already in Google is deleted."
                />
              )}
            </>
          );
        },
      );
    case "claude":
      return withIntegration(orgSlug, "CLAUDE", "ai", "Claude", async (p) => {
        const { organization, dto, canWrite, canRemove } = p;
        return (
          <>
            <p className="text-muted-foreground text-sm">
              Optional. Your own Claude key runs the AI imports (action items into tasks, a calendar
              screenshot into events) and the org chart importer. Usage is billed to your Anthropic
              account.
            </p>
            <StatusPanel dto={dto} secretLabel="API key" />
            <ClaudeForm orgId={organization.id} dto={dto} canWrite={canWrite} />
            {dto.hasSecret && (
              <TestAndRemove
                orgId={organization.id}
                provider="CLAUDE"
                name="the Claude key"
                canTest={canWrite}
                canRemove={canRemove}
                removeCopy="The key is deleted. Imports keep working with Bananasplit's own parser; documents it cannot read will need a new key."
              />
            )}
          </>
        );
      });
    case "ai-model":
      return withIntegration(orgSlug, "OPENAI_COMPATIBLE", "ai", "Other AI models", async (p) => {
        const { organization, dto, canWrite, canRemove } = p;
        return (
          <>
            <p className="text-muted-foreground text-sm">
              Optional. The AI imports use whichever model you connect: this one, or Claude. Members
              pick between them when both are set up.
            </p>
            <StatusPanel dto={dto} secretLabel="API key" />
            <AiModelForm orgId={organization.id} dto={dto} canWrite={canWrite} />
            {dto.hasSecret && (
              <TestAndRemove
                orgId={organization.id}
                provider="OPENAI_COMPATIBLE"
                name="the model key"
                canTest={canWrite}
                canRemove={canRemove}
                removeCopy="The key is deleted. The AI imports use Claude if it's connected, and are off otherwise."
              />
            )}
          </>
        );
      });
    case "data-source":
      return withIntegration(orgSlug, "SUPABASE_SOURCE", "integrations", "Supabase", async (p) => {
        const { organization, dto, canWrite, canRemove } = p;
        const version =
          typeof dto.config.contractVersion === "string" ? dto.config.contractVersion : null;
        return (
          <>
            <p className="text-muted-foreground text-sm">
              Check-ins, sign-ups and ballots from your website&apos;s Supabase database, synced
              into Databases. Bananasplit connects with a read-only role.
              {version ? ` Export contract version ${version}.` : ""}
            </p>
            <StatusPanel dto={dto} secretLabel="Password" />
            <SupabaseForm orgId={organization.id} dto={dto} canWrite={canWrite} />
            {dto.hasSecret && (
              <TestAndRemove
                orgId={organization.id}
                provider="SUPABASE_SOURCE"
                name="the website data connection"
                canTest={canWrite}
                canRemove={canRemove}
                removeCopy="The password is deleted and syncing stops. Data already synced stays."
              />
            )}
            <SetupHelp title="How to set up the read-only role">
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  In the website repository, run <code>supabase/suite-export.sql</code> in the
                  Supabase SQL editor. It creates the <code>suite_export</code> functions and the{" "}
                  <code>cbc_suite_reader</code> role, which can call only those functions.
                </li>
                <li>
                  Set a strong password for the role (ALTER ROLE cbc_suite_reader PASSWORD …).
                </li>
                <li>
                  Copy the project ref, and the pooler region and host prefix from Supabase &gt;
                  Connect &gt; Session pooler (the host looks like
                  aws-0-us-east-1.pooler.supabase.com).
                </li>
              </ol>
            </SetupHelp>
          </>
        );
      });
    case "website":
      return withIntegration(
        orgSlug,
        "NETLIFY_BUILD_HOOK",
        "websiteSync",
        "Website build hook",
        async (p) => {
          const { organization, dto, canWrite, canRemove } = p;
          return (
            <>
              <p className="text-muted-foreground text-sm">
                When public events change, Netlify rebuilds your website so it shows the new
                schedule (at most once a minute).
              </p>
              <StatusPanel dto={dto} secretLabel="Hook" />
              <NetlifyForm orgId={organization.id} dto={dto} canWrite={canWrite} />
              {dto.hasSecret && (
                <TestAndRemove
                  orgId={organization.id}
                  provider="NETLIFY_BUILD_HOOK"
                  name="the build hook"
                  canTest={canWrite}
                  canRemove={canRemove}
                  testLabel="Trigger a test build"
                  removeCopy="The hook is deleted. Your website stops rebuilding automatically when events change."
                />
              )}
            </>
          );
        },
      );
  }
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadIntegrationPage>>>;

/** A stored integration's window: the plan check, the viewer's rights, then its body. */
async function withIntegration(
  orgSlug: string,
  provider: IntegrationProvider,
  feature: PlanFeature,
  title: string,
  body: (page: Loaded) => Promise<ReactNode>,
): Promise<Panel | null> {
  const locked = await planGate(orgSlug, feature, { title });
  if (locked) return { title, body: locked };
  const page = await loadIntegrationPage(orgSlug, provider);
  if (!page || !page.canWrite) return null;
  return { title, summary: integrationSummary(page.dto), body: await body(page) };
}

const VIDEO: Record<string, string> = {
  zoom: "ZOOM",
  "google-meet": "GOOGLE_MEET",
  "microsoft-teams": "MICROSOFT_TEAMS",
};

async function videoPanel(app: string, orgSlug: string): Promise<Panel | null> {
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "integrations.write")) return null;
  const connections = await loadMeetingConnections(organization.id);
  const c = connections.find((x) => x.provider === VIDEO[app]);
  if (!c) return null;
  return {
    title: c.label,
    summary: c.connected ? "Connected" : c.needsReauth ? "Needs reconnecting" : "Not connected",
    body: <VideoProviderPanel orgId={organization.id} connection={c} canConnect />,
  };
}
