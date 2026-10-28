"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AI_VENDORS, aiVendor } from "@/lib/ai/vendors";
import { claudeModel, estimateParseCostUsd, formatUsd } from "@/lib/org-chart/models";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  SUPABASE_POOLER_REGIONS,
  type IntegrationDto,
} from "@/server/integrations/catalog";

import {
  disconnectGoogleAction,
  saveAiModelAction,
  saveClaudeAction,
  saveEmailSenderAction,
  saveGoogleCalendarsAction,
  saveNetlifyHookAction,
  saveSupabaseAction,
  sendTestEmailAction,
} from "./actions";
import { nativeSelectClass, SettingsCard } from "../settings-card";
import { FeedbackLine, SecretInput, feedbackOf, type Feedback } from "./integration-ui";

const selectClass = nativeSelectClass;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function useSubmit() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  function submit(fn: () => Promise<Parameters<typeof feedbackOf>[0]>, after?: () => void) {
    setFeedback(null);
    startTransition(async () => {
      const result = await fn();
      setFeedback(feedbackOf(result));
      if (result.ok) after?.();
      router.refresh();
    });
  }
  return { feedback, isPending, submit };
}

// ---------------------------------------------------------------- Other AI models

/**
 * An OpenAI-compatible model API: a provider from the fixed list, the model
 * id as the provider writes it, and the key (write-only, like every key).
 */
export function AiModelForm({
  orgId,
  dto,
  canWrite,
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [vendorId, setVendorId] = useState(str(dto.config.vendor) || AI_VENDORS[0].id);
  const [model, setModel] = useState(str(dto.config.model));
  const { feedback, isPending, submit } = useSubmit();
  const vendor = aiVendor(vendorId) ?? AI_VENDORS[0];
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveAiModelAction(orgId, { apiKey: apiKey || undefined, vendor: vendorId, model }),
          () => setApiKey(""),
        );
      }}
    >
      <SettingsCard
        title="Provider, key and model"
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending || !model.trim()}>
              {isPending ? "Saving and testing…" : dto.hasSecret ? "Save" : "Save and test"}
            </Button>
          )
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="ai-vendor">Provider</Label>
          <select
            id="ai-vendor"
            className={selectClass}
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            disabled={!canWrite}
          >
            {AI_VENDORS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-[13px]">
            Bananasplit only ever calls the provider&apos;s official address (
            {vendor.baseUrl.replace("https://", "")}).
          </p>
        </div>
        <SecretInput
          id="ai-key"
          label="API key"
          hasSecret={dto.hasSecret}
          last4={dto.last4}
          value={apiKey}
          onChange={setApiKey}
          placeholder={vendor.keyHint}
          help={`Create one at ${vendor.keysUrl}, on an account your organization pays for. Changing the provider needs that provider's key.`}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="ai-model">Model</Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={`e.g. ${vendor.exampleModel}`}
            maxLength={120}
            disabled={!canWrite}
          />
          <p className="text-muted-foreground text-[13px]">
            The model id exactly as {vendor.label} lists it. Pick one that can read images if
            you&apos;ll import calendar screenshots. Usage is billed to your {vendor.label} account.
          </p>
        </div>
      </SettingsCard>
    </form>
  );
}

// ---------------------------------------------------------------- Claude

export function ClaudeForm({
  orgId,
  dto,
  canWrite,
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(str(dto.config.model) || DEFAULT_CLAUDE_MODEL);
  const [fallbacks, setFallbacks] = useState(dto.config.fallbacks !== false);
  const { feedback, isPending, submit } = useSubmit();
  const selected = claudeModel(model);
  const perImport = estimateParseCostUsd(model);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveClaudeAction(orgId, { apiKey: apiKey || undefined, model, fallbacks }),
          () => setApiKey(""),
        );
      }}
    >
      <SettingsCard
        title="Key and model"
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving and testing…" : dto.hasSecret ? "Save" : "Save and test"}
            </Button>
          )
        }
      >
        <SecretInput
          id="claude-key"
          label="API key"
          hasSecret={dto.hasSecret}
          last4={dto.last4}
          value={apiKey}
          onChange={setApiKey}
          placeholder="sk-ant-…"
          help="Create one at console.anthropic.com under API keys, in a workspace your organization pays for."
        />
        <div className="grid gap-1.5">
          <Label htmlFor="claude-model">Model</Label>
          <select
            id="claude-model"
            className={selectClass}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {CLAUDE_MODELS.map((m) => {
              const cost = estimateParseCostUsd(m.id);
              return (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.id === DEFAULT_CLAUDE_MODEL ? " (default)" : ""}
                  {cost !== null ? ` — about ${formatUsd(cost)} per import` : ""}
                </option>
              );
            })}
          </select>
          <p className="text-muted-foreground text-[13px]">
            {selected?.note} About {perImport !== null ? formatUsd(perImport) : "—"} per import of a
            chart for a typical leadership team (
            {selected
              ? `$${selected.inputPerMTok} in / $${selected.outputPerMTok} out per million
          tokens`
              : "list price"}
            ), billed to your Anthropic account. Most documents never reach Claude at all: the
            portal reads them itself, for nothing.
          </p>
        </div>
        {selected?.serverFallbacks && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="claude-fallbacks">Retry declined requests on a fallback model</Label>
              <p className="text-muted-foreground mt-1 text-[13px]">
                If Claude declines a document, Anthropic re-runs it on its recommended fallback
                model.
              </p>
            </div>
            <Switch id="claude-fallbacks" checked={fallbacks} onCheckedChange={setFallbacks} />
          </div>
        )}
      </SettingsCard>
    </form>
  );
}

// ---------------------------------------------------------------- Email sender

export function EmailSenderForm({
  orgId,
  dto,
  canWrite,
  orgName,
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
  orgName: string;
}) {
  const [fromName, setFromName] = useState(str(dto.config.fromName) || orgName);
  const [fromAddress, setFromAddress] = useState(str(dto.config.fromAddress));
  const [replyTo, setReplyTo] = useState(str(dto.config.replyTo));
  const [apiKey, setApiKey] = useState("");
  const save = useSubmit();
  const test = useSubmit();
  return (
    <div className="space-y-4.5">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.submit(
            () =>
              saveEmailSenderAction(orgId, {
                fromName,
                fromAddress,
                replyTo: replyTo || undefined,
                apiKey: apiKey || undefined,
              }),
            () => setApiKey(""),
          );
        }}
      >
        <SettingsCard
          title="Sender"
          description="Who your organization's email comes from, and the Resend key that sends it."
          status={save.feedback && <FeedbackLine feedback={save.feedback} />}
          footer={
            canWrite && (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving and checking the domain…" : "Save and check domain"}
              </Button>
            )
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="from-name">From name</Label>
              <Input
                id="from-name"
                value={fromName}
                maxLength={80}
                onChange={(e) => setFromName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="from-address">From address</Label>
              <Input
                id="from-address"
                type="email"
                value={fromAddress}
                placeholder="team@mail.yourorg.com"
                onChange={(e) => setFromAddress(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="reply-to">Reply-to (optional)</Label>
              <Input
                id="reply-to"
                type="email"
                value={replyTo}
                placeholder="president@yourorg.com"
                onChange={(e) => setReplyTo(e.target.value)}
              />
            </div>
          </div>
          <SecretInput
            id="resend-key"
            label="Resend API key"
            hasSecret={dto.hasSecret}
            last4={dto.last4}
            value={apiKey}
            onChange={setApiKey}
            placeholder="re_…"
            help="A Resend key with full access (the domain check reads your domains)."
          />
        </SettingsCard>
      </form>
      {canWrite && dto.hasSecret && (
        <SettingsCard
          title="Send a test email"
          description="Sends one message from this sender to your own address."
          status={test.feedback && <FeedbackLine feedback={test.feedback} />}
          footer={
            <Button
              disabled={test.isPending}
              onClick={() => test.submit(() => sendTestEmailAction(orgId))}
            >
              {test.isPending ? "Sending…" : "Send test email"}
            </Button>
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Supabase

export function SupabaseForm({
  orgId,
  dto,
  canWrite,
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
}) {
  const [projectRef, setProjectRef] = useState(str(dto.config.projectRef));
  const [poolerRegion, setPoolerRegion] = useState(str(dto.config.poolerRegion) || "us-east-1");
  const [poolerPrefix, setPoolerPrefix] = useState(str(dto.config.poolerPrefix) || "aws-0");
  const [roleName, setRoleName] = useState(str(dto.config.roleName) || "cbc_suite_reader");
  const [password, setPassword] = useState("");
  const { feedback, isPending, submit } = useSubmit();
  const host = `${poolerPrefix}-${poolerRegion}.pooler.supabase.com`;
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () =>
            saveSupabaseAction(orgId, {
              projectRef,
              poolerRegion,
              poolerPrefix,
              roleName,
              password: password || undefined,
            }),
          () => setPassword(""),
        );
      }}
    >
      <SettingsCard
        title="Connection"
        description="Read-only, with verified TLS. The host is built from these fields; other hosts are not accepted."
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving and connecting…" : "Save and test"}
            </Button>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sb-ref">Project ref</Label>
            <Input
              id="sb-ref"
              value={projectRef}
              placeholder="abcdefghijklmnopqrst"
              autoComplete="off"
              onChange={(e) => setProjectRef(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sb-role">Database role</Label>
            <Input
              id="sb-role"
              value={roleName}
              autoComplete="off"
              onChange={(e) => setRoleName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sb-region">Pooler region</Label>
            <select
              id="sb-region"
              className={selectClass}
              value={poolerRegion}
              onChange={(e) => setPoolerRegion(e.target.value)}
            >
              {SUPABASE_POOLER_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sb-prefix">Pooler host prefix</Label>
            <select
              id="sb-prefix"
              className={selectClass}
              value={poolerPrefix}
              onChange={(e) => setPoolerPrefix(e.target.value)}
            >
              <option value="aws-0">aws-0</option>
              <option value="aws-1">aws-1</option>
            </select>
          </div>
        </div>
        <p className="bg-muted/60 rounded-field text-muted-foreground px-3.5 py-2.5 text-[13px]">
          Connects to <code className="text-foreground font-mono">{host}</code> as{" "}
          <code className="text-foreground font-mono">
            {roleName || "role"}.{projectRef || "ref"}
          </code>
          .
        </p>
        <SecretInput
          id="sb-password"
          label="Role password"
          hasSecret={dto.hasSecret}
          last4={dto.last4}
          value={password}
          onChange={setPassword}
          placeholder="The cbc_suite_reader password"
        />
      </SettingsCard>
    </form>
  );
}

// ---------------------------------------------------------------- Netlify

export function NetlifyForm({
  orgId,
  dto,
  canWrite,
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
}) {
  const [hook, setHook] = useState("");
  const { feedback, isPending, submit } = useSubmit();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveNetlifyHookAction(orgId, hook),
          () => setHook(""),
        );
      }}
    >
      <SettingsCard
        title="Build hook"
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending || !hook.trim()}>
              {isPending ? "Saving…" : "Save hook"}
            </Button>
          )
        }
      >
        <SecretInput
          id="netlify-hook"
          label="Build hook URL"
          hasSecret={dto.hasSecret}
          last4={dto.last4}
          value={hook}
          onChange={setHook}
          placeholder="https://api.netlify.com/build_hooks/…"
          help="Netlify: Site configuration > Build & deploy > Build hooks > Add build hook."
        />
      </SettingsCard>
    </form>
  );
}

// ---------------------------------------------------------------- Google Calendar

interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
}

export function GoogleCalendarPanel({
  orgId,
  dto,
  canWrite,
  configured,
  importPanel,
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
  configured: boolean;
  /** The calendar's import card (dry run, results, apply), rendered by the page. */
  importPanel?: ReactNode;
}) {
  const calendars = (
    Array.isArray(dto.config.calendars) ? dto.config.calendars : []
  ) as CalendarOption[];
  const [publicId, setPublicId] = useState(str(dto.config.publicCalendarId));
  const [internalId, setInternalId] = useState(str(dto.config.internalCalendarId));
  const save = useSubmit();
  const disconnect = useSubmit();
  const connected = dto.status === "CONNECTED" || dto.status === "ERROR";

  return (
    <div className="space-y-4.5">
      {canWrite && (
        <form method="post" action="/api/integrations/google-calendar/start">
          <input type="hidden" name="orgId" value={orgId} />
          <SettingsCard
            title="Google account"
            description={
              dto.hasSecret && connected
                ? `Connected${dto.config.accountEmail ? ` as ${str(dto.config.accountEmail)}` : ""}. Reconnect to switch accounts.`
                : "Sign in with the Google account that owns your organization's calendars."
            }
            status={
              !configured && (
                <p className="text-muted-foreground text-[13px]">
                  Not available yet: the platform needs a Google OAuth client
                  (GOOGLE_CALENDAR_CLIENT_ID).
                </p>
              )
            }
            footer={
              <Button type="submit" disabled={!configured}>
                {dto.hasSecret && connected
                  ? "Reconnect Google Calendar"
                  : "Connect Google Calendar"}
              </Button>
            }
          >
            <p className="text-muted-foreground text-sm">
              Bananasplit asks to manage events on the calendars you own and to list your calendars.
              It adds and changes only the events it mirrors. It reads your other events only when
              you run the import, and only on the public events calendar you choose.
            </p>
          </SettingsCard>
        </form>
      )}
      {connected && calendars.length > 0 && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.submit(() =>
              saveGoogleCalendarsAction(orgId, {
                publicCalendarId: publicId || null,
                internalCalendarId: internalId || null,
              }),
            );
          }}
        >
          <SettingsCard
            title="Calendars"
            description="Which of your Google calendars each kind of event is mirrored to."
            status={save.feedback && <FeedbackLine feedback={save.feedback} />}
            footer={
              canWrite && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save calendars"}
                </Button>
              )
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="gcal-public">Public events calendar</Label>
                <select
                  id="gcal-public"
                  className={selectClass}
                  value={publicId}
                  onChange={(e) => setPublicId(e.target.value)}
                >
                  <option value="">Don&apos;t mirror public events</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-[13px]">
                  The import reads existing events from this calendar too. Without one, public
                  events stay off Google and nothing is imported.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gcal-internal">Internal events calendar (optional)</Label>
                <select
                  id="gcal-internal"
                  className={selectClass}
                  value={internalId}
                  onChange={(e) => setInternalId(e.target.value)}
                >
                  <option value="">Don&apos;t mirror internal events</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </SettingsCard>
        </form>
      )}
      {importPanel}
      {canWrite && dto.hasSecret && dto.status !== "DISCONNECTED" && (
        <SettingsCard
          title="Disconnect"
          description="Revokes the portal's access at Google. Events stop mirroring until you connect again."
          status={disconnect.feedback && <FeedbackLine feedback={disconnect.feedback} />}
          footer={
            <Button
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() => disconnect.submit(() => disconnectGoogleAction(orgId))}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          }
        />
      )}
    </div>
  );
}
