"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  SUPABASE_POOLER_REGIONS,
  type IntegrationDto,
} from "@/server/integrations/catalog";

import {
  disconnectGoogleAction,
  saveClaudeAction,
  saveEmailSenderAction,
  saveGoogleCalendarsAction,
  saveNetlifyHookAction,
  saveSupabaseAction,
  sendTestEmailAction,
  setMailFallbackAction,
} from "./actions";
import { FeedbackLine, SecretInput, feedbackOf, type Feedback } from "./integration-ui";

const selectClass = "border-input bg-background h-9 w-full rounded-md border px-3 text-sm";

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
  const [model, setModel] = useState(str(dto.config.defaultModel) || DEFAULT_CLAUDE_MODEL);
  const { feedback, isPending, submit } = useSubmit();
  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveClaudeAction(orgId, { apiKey: apiKey || undefined, defaultModel: model }),
          () => setApiKey(""),
        );
      }}
    >
      <SecretInput
        id="claude-key"
        label="API key"
        last4={dto.last4}
        value={apiKey}
        onChange={setApiKey}
        placeholder="sk-ant-…"
        help="Create one at console.anthropic.com under API keys, in a workspace your club pays for."
      />
      <div className="grid gap-1.5">
        <Label htmlFor="claude-model">Default model</Label>
        <select
          id="claude-model"
          className={selectClass}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {CLAUDE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">Used to read uploaded org charts.</p>
      </div>
      {canWrite && (
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving and testing…" : dto.hasSecret ? "Save" : "Save and test"}
        </Button>
      )}
      <FeedbackLine feedback={feedback} />
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
    <div className="space-y-4">
      <form
        className="space-y-4 rounded-lg border p-4"
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
              placeholder="team@mail.yourclub.org"
              onChange={(e) => setFromAddress(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="reply-to">Reply-to (optional)</Label>
            <Input
              id="reply-to"
              type="email"
              value={replyTo}
              placeholder="president@yourclub.org"
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </div>
        </div>
        <SecretInput
          id="resend-key"
          label="Resend API key"
          last4={dto.last4}
          value={apiKey}
          onChange={setApiKey}
          placeholder="re_…"
          help="A Resend key with full access (the domain check reads your domains)."
        />
        {canWrite && (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving and checking the domain…" : "Save and check domain"}
          </Button>
        )}
        <FeedbackLine feedback={save.feedback} />
      </form>
      {canWrite && dto.hasSecret && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-sm font-medium">Send a test email</p>
          <p className="text-muted-foreground text-xs">
            Sends one message from this sender to your own address.
          </p>
          <Button
            variant="outline"
            disabled={test.isPending}
            onClick={() => test.submit(() => sendTestEmailAction(orgId))}
          >
            {test.isPending ? "Sending…" : "Send test email"}
          </Button>
          <FeedbackLine feedback={test.feedback} />
        </div>
      )}
    </div>
  );
}

export function MailFallbackToggle({
  orgId,
  enabled,
  canEdit,
}: {
  orgId: string;
  enabled: boolean;
  canEdit: boolean;
}) {
  const { feedback, isPending, submit } = useSubmit();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
      <div className="max-w-md">
        <Label htmlFor="mail-fallback">Use the platform sender until yours is verified</Label>
        <p className="text-muted-foreground text-xs">
          While on and your own sender is not verified, notification email goes out from the
          platform address &ldquo;on behalf of&rdquo; your organization. Off means in-app
          notifications only until your sender is verified. Connecting a verified sender turns this
          off.
          {canEdit ? "" : " Only an owner can change this."}
        </p>
        <FeedbackLine feedback={feedback} />
      </div>
      <Switch
        id="mail-fallback"
        checked={enabled}
        disabled={!canEdit || isPending}
        onCheckedChange={(v) => submit(() => setMailFallbackAction(orgId, v))}
      />
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
      className="space-y-4 rounded-lg border p-4"
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
      <p className="text-muted-foreground text-xs">
        Connects to <code>{host}</code> as{" "}
        <code>
          {roleName || "role"}.{projectRef || "ref"}
        </code>
        , read-only, with verified TLS. The host is built from these fields; other hosts are not
        accepted.
      </p>
      <SecretInput
        id="sb-password"
        label="Role password"
        last4={dto.last4}
        value={password}
        onChange={setPassword}
        placeholder="The cbc_suite_reader password"
      />
      {canWrite && (
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving and connecting…" : "Save and test"}
        </Button>
      )}
      <FeedbackLine feedback={feedback} />
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
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveNetlifyHookAction(orgId, hook),
          () => setHook(""),
        );
      }}
    >
      <SecretInput
        id="netlify-hook"
        label="Build hook URL"
        last4={dto.last4}
        value={hook}
        onChange={setHook}
        placeholder="https://api.netlify.com/build_hooks/…"
        help="Netlify: Site configuration > Build & deploy > Build hooks > Add build hook."
      />
      {canWrite && (
        <Button type="submit" disabled={isPending || !hook.trim()}>
          {isPending ? "Saving…" : "Save hook"}
        </Button>
      )}
      <FeedbackLine feedback={feedback} />
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
}: {
  orgId: string;
  dto: IntegrationDto;
  canWrite: boolean;
  configured: boolean;
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
    <div className="space-y-4">
      {canWrite && (
        <form
          method="post"
          action="/api/integrations/google-calendar/start"
          className="rounded-lg border p-4"
        >
          <input type="hidden" name="orgId" value={orgId} />
          <p className="mb-2 text-sm">
            {dto.hasSecret && connected
              ? `Connected${dto.config.accountEmail ? ` as ${str(dto.config.accountEmail)}` : ""}. Reconnect to switch accounts.`
              : "Sign in with the Google account that owns your club's calendars."}
          </p>
          <p className="text-muted-foreground mb-3 text-xs">
            CBC Portal asks only to manage the events it creates and to list your calendars. It
            never reads other events.
          </p>
          <Button type="submit" disabled={!configured}>
            {dto.hasSecret && connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
          </Button>
          {!configured && (
            <p className="text-muted-foreground mt-2 text-xs">
              Not available yet: the platform needs a Google OAuth client
              (GOOGLE_CALENDAR_CLIENT_ID).
            </p>
          )}
        </form>
      )}
      {connected && calendars.length > 0 && (
        <form
          className="space-y-4 rounded-lg border p-4"
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
          {canWrite && (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save calendars"}
            </Button>
          )}
          <FeedbackLine feedback={save.feedback} />
        </form>
      )}
      {canWrite && dto.hasSecret && dto.status !== "DISCONNECTED" && (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => disconnect.submit(() => disconnectGoogleAction(orgId))}
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
          <FeedbackLine feedback={disconnect.feedback} />
        </div>
      )}
    </div>
  );
}
