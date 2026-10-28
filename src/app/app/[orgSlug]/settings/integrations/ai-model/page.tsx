import Link from "next/link";

import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { AiModelForm } from "../provider-forms";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Settings > Integrations > Other AI models: an OpenAI-compatible API
 * (OpenAI, Gemini, OpenRouter, Mistral, Groq, Together, DeepSeek, xAI) for
 * the AI imports, next to the Claude key.
 */
export default async function AiModelIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations/ai-model">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "ai");
  if (planLock) return planLock;
  const page = await loadIntegrationPage(orgSlug, "OPENAI_COMPATIBLE");
  if (!page) return <SettingsNoAccess title="Other AI models" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;

  return (
    <div className="max-w-3xl space-y-7.5">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Other AI models"
        dto={dto}
        description="Optional. The AI imports (a pasted list of action items into tasks, a calendar screenshot into events) use whichever model your organization connects: this one, or Claude. Members pick between them when both are set up."
      />
      <div className="space-y-4.5">
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
      </div>
      <p className="text-muted-foreground text-sm">
        Prefer Claude? Connect it under{" "}
        <Link
          href={`/app/${orgSlug}/settings/integrations/claude`}
          className="text-foreground font-medium underline underline-offset-4"
        >
          Claude API
        </Link>
        .
      </p>
    </div>
  );
}
