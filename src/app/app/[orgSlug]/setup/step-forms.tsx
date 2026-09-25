"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { FailureNote } from "@/components/setup/setup-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SUCCESS_TEXT } from "@/lib/status-tones";
import { cn } from "@/lib/utils";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  SUPABASE_POOLER_REGIONS,
} from "@/server/integrations/catalog";

import {
  connectClaudeAction,
  connectDataSourceAction,
  connectEmailAction,
  saveSetupCalendarsAction,
  type SetupResult,
} from "./actions";
import type { SetupStepView } from "./view";

/**
 * The four credential forms of the guided setup.
 *
 * Every secret field is write-only: never prefilled, never read back,
 * cleared the moment the save succeeds. The forms hold the pasted value in
 * React state only long enough to post it to the action, which hands it to
 * src/server/secrets and returns ok or a reason — never the value.
 *
 * Each form owns its failure: the reason the service gave, plus the one
 * thing to change (src/server/setup/diagnose), and the field to go back to.
 */

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface FormProps {
  orgId: string;
  view: SetupStepView;
  /**
   * Optional extra to run after a save whose test passed. The panel itself
   * is server-rendered, so router.refresh() is what swaps it to the result
   * screen; a server component may not pass a function across, and does not
   * need to.
   */
  onConnected?: () => void;
}

/** Shared submit plumbing: one in-flight request, one result, one retry. */
function useConnect(onConnected?: () => void) {
  const router = useRouter();
  const [result, setResult] = useState<SetupResult | null>(null);
  const [isPending, start] = useTransition();
  function submit(fn: () => Promise<SetupResult>, after?: () => void) {
    setResult(null);
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        after?.();
        router.refresh();
        onConnected?.();
      }
    });
  }
  const failure = result && !result.ok ? result : null;
  return { result, failure, isPending, submit };
}

/** The error under the field it belongs to, so the eye lands in the right place. */
function fieldInvalid(failure: SetupResult | null, field: string): boolean {
  return Boolean(failure && !failure.ok && failure.field === field);
}

function SecretField({
  id,
  label,
  placeholder,
  help,
  value,
  onChange,
  view,
  invalid,
}: {
  id: string;
  label: string;
  placeholder: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
  view: SetupStepView;
  invalid?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          view.hasSecret
            ? `Saved${view.last4 ? ` (•••• ${view.last4})` : ""}. Paste a new one to replace it.`
            : placeholder
        }
      />
      <p className="text-muted-foreground text-xs">
        {help ? `${help} ` : ""}Encrypted before it is stored; never shown again.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Website data

export function DataSourceForm({ orgId, view, onConnected }: FormProps) {
  const [projectRef, setProjectRef] = useState(str(view.config.projectRef));
  const [poolerRegion, setPoolerRegion] = useState(str(view.config.poolerRegion) || "us-east-1");
  const [poolerPrefix, setPoolerPrefix] = useState(str(view.config.poolerPrefix) || "aws-0");
  const [roleName, setRoleName] = useState(str(view.config.roleName) || "cbc_suite_reader");
  const [password, setPassword] = useState("");
  const { failure, isPending, submit } = useConnect(onConnected);
  const host = `${poolerPrefix}-${poolerRegion}.pooler.supabase.com`;

  function save() {
    submit(
      () =>
        connectDataSourceAction(orgId, {
          projectRef,
          poolerRegion,
          poolerPrefix,
          roleName,
          password: password || undefined,
        }),
      () => setPassword(""),
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="setup-sb-ref">Project ref</Label>
          <Input
            id="setup-sb-ref"
            value={projectRef}
            autoComplete="off"
            spellCheck={false}
            placeholder="abcdefghijklmnopqrst"
            aria-invalid={fieldInvalid(failure, "projectRef") || undefined}
            onChange={(e) => setProjectRef(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">20 lowercase letters.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="setup-sb-role">Database role</Label>
          <Input
            id="setup-sb-role"
            value={roleName}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setRoleName(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">The one suite-export.sql created.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="setup-sb-region">Pooler region</Label>
          <select
            id="setup-sb-region"
            className={selectClass}
            value={poolerRegion}
            aria-invalid={fieldInvalid(failure, "poolerRegion") || undefined}
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
          <Label htmlFor="setup-sb-prefix">Pooler host prefix</Label>
          <select
            id="setup-sb-prefix"
            className={selectClass}
            value={poolerPrefix}
            onChange={(e) => setPoolerPrefix(e.target.value)}
          >
            <option value="aws-0">aws-0</option>
            <option value="aws-1">aws-1</option>
          </select>
        </div>
      </div>
      <p className="text-muted-foreground bg-muted/40 rounded-md border p-2.5 text-xs">
        Connects to <span className="font-mono">{host}</span> as{" "}
        <span className="font-mono">
          {roleName || "role"}.{projectRef || "ref"}
        </span>
        , read-only, TLS verified. The host is built from these four fields — no other host is ever
        accepted.
      </p>
      <SecretField
        id="setup-sb-password"
        label="Reader password"
        placeholder="The password you set in step 3"
        value={password}
        onChange={setPassword}
        view={view}
        invalid={fieldInvalid(failure, "password")}
      />
      {failure ? <FailureNote reason={failure.error} fix={failure.fix} /> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Connecting…" : "Connect and pull data"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- Google Calendar

interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
}

export function CalendarForm({
  orgId,
  view,
  onConnected,
  configured,
}: FormProps & { configured: boolean }) {
  const calendars = (
    Array.isArray(view.config.calendars) ? view.config.calendars : []
  ) as CalendarOption[];
  const [publicId, setPublicId] = useState(str(view.config.publicCalendarId));
  const [internalId, setInternalId] = useState(str(view.config.internalCalendarId));
  const { failure, isPending, submit } = useConnect(onConnected);
  const signedIn = view.hasSecret && view.status !== "todo" && view.status !== "skipped";
  const account = str(view.config.accountEmail);

  return (
    <div className="space-y-4">
      <form method="post" action="/api/integrations/google-calendar/start" className="space-y-3">
        <input type="hidden" name="orgId" value={orgId} />
        {signedIn && account ? (
          <p className={cn("text-sm", SUCCESS_TEXT)}>Signed in as {account}.</p>
        ) : null}
        <Button type="submit" disabled={!configured}>
          {signedIn ? "Reconnect Google Calendar" : "Connect Google Calendar"}
        </Button>
        {!configured ? (
          <p className="text-muted-foreground text-xs">
            Not available in this environment: the platform has no Google OAuth client
            (GOOGLE_CALENDAR_CLIENT_ID). Everything else on this page works; ask whoever runs the
            deployment to add one, then come back.
          </p>
        ) : null}
      </form>

      {signedIn && calendars.length > 0 ? (
        <form
          className="space-y-4 border-t pt-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            submit(() =>
              saveSetupCalendarsAction(orgId, {
                publicCalendarId: publicId || null,
                internalCalendarId: internalId || null,
              }),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="setup-gcal-public">Public events go to</Label>
              <select
                id="setup-gcal-public"
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
              <Label htmlFor="setup-gcal-internal">Internal events go to</Label>
              <select
                id="setup-gcal-internal"
                className={selectClass}
                value={internalId}
                onChange={(e) => setInternalId(e.target.value)}
              >
                <option value="">Nowhere (keep them in the portal)</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                    {c.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {failure ? <FailureNote reason={failure.error} fix={failure.fix} /> : null}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save calendars"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Email sender

export function EmailForm({ orgId, view, onConnected, orgName }: FormProps & { orgName: string }) {
  const [fromName, setFromName] = useState(str(view.config.fromName) || orgName);
  const [fromAddress, setFromAddress] = useState(str(view.config.fromAddress));
  const [replyTo, setReplyTo] = useState(str(view.config.replyTo));
  const [apiKey, setApiKey] = useState("");
  const { failure, isPending, submit } = useConnect(onConnected);

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () =>
            connectEmailAction(orgId, {
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
          <Label htmlFor="setup-from-name">From name</Label>
          <Input
            id="setup-from-name"
            value={fromName}
            maxLength={80}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="setup-from-address">From address</Label>
          <Input
            id="setup-from-address"
            type="email"
            value={fromAddress}
            placeholder="team@mail.yourclub.org"
            aria-invalid={fieldInvalid(failure, "fromAddress") || undefined}
            onChange={(e) => setFromAddress(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">On the domain you verified in Resend.</p>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="setup-reply-to">Reply-to (optional)</Label>
          <Input
            id="setup-reply-to"
            type="email"
            value={replyTo}
            placeholder="president@yourclub.org"
            onChange={(e) => setReplyTo(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Where replies land. An officer inbox beats a no-reply address.
          </p>
        </div>
      </div>
      <SecretField
        id="setup-resend-key"
        label="Resend API key"
        placeholder="re_…"
        help="Full access, not sending-only."
        value={apiKey}
        onChange={setApiKey}
        view={view}
        invalid={fieldInvalid(failure, "apiKey")}
      />
      {failure ? <FailureNote reason={failure.error} fix={failure.fix} /> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Checking your domain…" : "Connect and check domain"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- Claude

export function ClaudeForm({ orgId, view, onConnected }: FormProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(str(view.config.model) || DEFAULT_CLAUDE_MODEL);
  const [fallbacks, setFallbacks] = useState(view.config.fallbacks !== false);
  const { failure, isPending, submit } = useConnect(onConnected);

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => connectClaudeAction(orgId, { apiKey: apiKey || undefined, model, fallbacks }),
          () => setApiKey(""),
        );
      }}
    >
      <SecretField
        id="setup-claude-key"
        label="API key"
        placeholder="sk-ant-…"
        value={apiKey}
        onChange={setApiKey}
        view={view}
        invalid={fieldInvalid(failure, "apiKey")}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="setup-claude-model">Model</Label>
        <select
          id="setup-claude-model"
          className={selectClass}
          value={model}
          aria-invalid={fieldInvalid(failure, "model") || undefined}
          onChange={(e) => setModel(e.target.value)}
        >
          {CLAUDE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          The test checks your key can actually use this one. Haiku is the cheapest and is usually
          enough for a one-page chart.
        </p>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="setup-claude-fallbacks">Retry a declined document</Label>
          <p className="text-muted-foreground text-xs">
            If Claude declines to read a document, Anthropic re-runs it once on its recommended
            fallback model. That second run is billed too.
          </p>
        </div>
        <Switch id="setup-claude-fallbacks" checked={fallbacks} onCheckedChange={setFallbacks} />
      </div>
      {failure ? <FailureNote reason={failure.error} fix={failure.fix} /> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Checking the key…" : "Connect and test"}
      </Button>
    </form>
  );
}
