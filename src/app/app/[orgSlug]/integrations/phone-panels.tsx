import type { ReactNode } from "react";

import type { Brand } from "@/components/marketing/brands";
import type { IntegrationProvider } from "@/generated/prisma/enums";
import { phoneWebhookUrls } from "@/server/crm/phone/connection";
import { toIntegrationDto, type IntegrationDto } from "@/server/integrations/catalog";
import { planGate } from "@/server/billing/plan-gate";
import { withOrgTx } from "@/server/db/context";

import { SetupHelp } from "./integration-header";
import { StatusPanel, TestAndRemove } from "./integration-ui";
import { loadIntegrationPage } from "./load";
import { CopyUrl, DeepgramForm, NumberPicker, TelnyxForm, TwilioForm } from "./phone-forms";
import { integrationSummary } from "./status-copy";

/**
 * Calls and texts on Integrations and apps (docs/features/crm.md, Phase 5):
 * Telnyx and Twilio for calls and texts, Deepgram for writing out calls and
 * voice notes, each on the organization's own key. A self-contained block:
 * the page adds `phoneTiles` as one group and the window opens `phonePanel`.
 */

export const PHONE_APPS = ["telnyx", "twilio", "deepgram"] as const;
export type PhoneApp = (typeof PHONE_APPS)[number];

const PROVIDER: Record<PhoneApp, "TELNYX" | "TWILIO" | "DEEPGRAM"> = {
  telnyx: "TELNYX",
  twilio: "TWILIO",
  deepgram: "DEEPGRAM",
};

const mark = (name: string, slug: string, color: string, ink: string, letters: string): Brand => ({
  name,
  slug,
  group: "inbox",
  color,
  ink,
  mark: letters,
});

export const PHONE_MARKS: Record<PhoneApp, Brand> = {
  telnyx: mark("Telnyx", "telnyx", "#00E3AA", "#0B1F1A", "Tx"),
  twilio: mark("Twilio", "twilio", "#F22F46", "#FFFFFF", "Tw"),
  deepgram: mark("Deepgram", "deepgram", "#13EF93", "#101014", "Dg"),
};

const COPY: Record<PhoneApp, { name: string; body: string }> = {
  telnyx: { name: "Telnyx", body: "Calls and texts from the CRM on your own number." },
  twilio: { name: "Twilio", body: "The same, for organizations on Twilio." },
  deepgram: { name: "Deepgram", body: "Writes out recorded calls and voice notes." },
};

export interface PhoneTile {
  key: PhoneApp;
  brand: Brand;
  name: string;
  body: string;
  state: "connected" | "attention" | "off";
  detail?: string;
  panel: true;
}

const checked = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

async function loadDtos(orgId: string): Promise<IntegrationDto[]> {
  const rows = await withOrgTx(orgId, ({ db }) =>
    db.orgIntegration.findMany({
      where: { organizationId: orgId, provider: { in: ["TELNYX", "TWILIO", "DEEPGRAM"] } },
      select: {
        provider: true,
        status: true,
        secretFingerprint: true,
        secretLast4: true,
        lastVerifiedAt: true,
        lastError: true,
        config: true,
        updatedAt: true,
        connectedBy: { select: { name: true } },
      },
    }),
  );
  return (["TELNYX", "TWILIO", "DEEPGRAM"] as const).map((p) =>
    toIntegrationDto(p, rows.find((r) => r.provider === p) ?? null),
  );
}

/** The three tiles, for the page's "Calls and texts" group. */
export async function phoneTiles(orgId: string): Promise<PhoneTile[]> {
  const dtos = await loadDtos(orgId);
  return PHONE_APPS.map((key) => {
    const dto = dtos.find((d) => d.provider === PROVIDER[key])!;
    const state =
      dto.status === "CONNECTED" ? "connected" : dto.status === "ERROR" || dto.status === "NEEDS_REAUTH" ? "attention" : "off";
    const number = typeof dto.config.number === "string" ? dto.config.number : null;
    return {
      key,
      brand: PHONE_MARKS[key],
      ...COPY[key],
      state,
      detail: number ?? (dto.lastVerifiedAt ? `Checked ${checked.format(new Date(dto.lastVerifiedAt))}` : undefined),
      panel: true,
    };
  });
}

export function isPhoneApp(app: unknown): app is PhoneApp {
  return typeof app === "string" && (PHONE_APPS as readonly string[]).includes(app);
}

/** One provider's window. Null for someone who can't set integrations up. */
export async function phonePanel(
  app: PhoneApp,
  orgSlug: string,
): Promise<{ title: string; summary?: string; body: ReactNode } | null> {
  const title = COPY[app].name;
  const locked = await planGate(orgSlug, "crm", { title });
  if (locked) return { title, body: locked };
  const provider = PROVIDER[app] as IntegrationProvider;
  const page = await loadIntegrationPage(orgSlug, provider);
  if (!page || !page.canWrite) return null;
  const orgId = page.organization.id;
  const dto = (await loadDtos(orgId)).find((d) => d.provider === provider)!;
  const urls = phoneWebhookUrls(orgId);
  const { canWrite, canRemove } = page;
  const body =
    app === "deepgram" ? (
      <>
        <p className="text-muted-foreground text-sm">
          Optional. With a key, recorded calls and voice notes are written out and summed up on the person&apos;s
          timeline. Deepgram bills your account, about $0.26 an hour of audio.
        </p>
        <StatusPanel dto={dto} secretLabel="API key" />
        <DeepgramForm orgId={orgId} dto={dto} canWrite={canWrite} />
        {dto.hasSecret && (
          <TestAndRemove
            orgId={orgId}
            provider="DEEPGRAM"
            name="the Deepgram key"
            canTest={canWrite}
            canRemove={canRemove}
            removeCopy="The key is deleted. Recordings and voice notes are kept as audio, without a written version."
          />
        )}
      </>
    ) : (
      <>
        <p className="text-muted-foreground text-sm">
          {app === "telnyx"
            ? "Members call from the browser, work down a list with the dialer, and text people who said yes to texts. Calls and texts are billed to your Telnyx account (about $0.007 a minute)."
            : "Members call from the browser, work down a list with the dialer, and text people who said yes to texts. Calls and texts are billed to your Twilio account."}
        </p>
        <StatusPanel dto={dto} secretLabel={app === "telnyx" ? "API key" : "Auth token"} />
        {app === "telnyx" ? (
          <TelnyxForm orgId={orgId} dto={dto} canWrite={canWrite} />
        ) : (
          <TwilioForm orgId={orgId} dto={dto} canWrite={canWrite} />
        )}
        {dto.hasSecret && (
          <NumberPicker orgId={orgId} provider={PROVIDER[app] as "TELNYX" | "TWILIO"} dto={dto} canWrite={canWrite} />
        )}
        {dto.hasSecret && (
          <TestAndRemove
            orgId={orgId}
            provider={provider}
            name={app === "telnyx" ? "Telnyx" : "Twilio"}
            canTest={canWrite}
            canRemove={canRemove}
            removeCopy="The keys are deleted. Calls fall back to your phone's own dialer; texting stops. Call and text history stays."
          />
        )}
        <SetupHelp title={`Addresses to paste into ${app === "telnyx" ? "Telnyx" : "Twilio"}`}>
          <div className="space-y-3 pt-1">
            {app === "telnyx" ? (
              <>
                <CopyUrl label="Webhook URL (the credential connection and the messaging profile)" url={urls.telnyx} />
                <ol className="list-decimal space-y-1.5 pl-5">
                  <li>Make a credential connection for calling from the browser and paste its ID above.</li>
                  <li>Set its webhook URL, and the messaging profile&apos;s, to the address above.</li>
                  <li>Give your number that messaging profile and that connection.</li>
                </ol>
              </>
            ) : (
              <>
                <CopyUrl label="A message comes in (your number, Messaging)" url={urls.twilioSms} />
                <CopyUrl label="Call status changes" url={urls.twilioStatus} />
                <CopyUrl label="Voice (set for you on the Bananasplit softphone app)" url={urls.twilioVoice} />
              </>
            )}
          </div>
        </SetupHelp>
      </>
    );
  return { title, summary: integrationSummary(dto), body };
}
