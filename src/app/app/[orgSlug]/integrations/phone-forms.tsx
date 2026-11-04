"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import type { IntegrationDto } from "@/server/integrations/catalog";

import { SettingsCard } from "../settings/settings-card";
import { FeedbackLine, SecretInput, feedbackOf, type ActionResult, type Feedback } from "./integration-ui";
import { saveDeepgramAction, saveTelnyxAction, saveTwilioAction, setPhoneNumberAction } from "./phone-actions";

/**
 * The forms in the Telnyx, Twilio and Deepgram windows (phone-panels.tsx):
 * keys are write-only like every key; the number is picked from the
 * account's own list (buttons, not a dropdown) or typed; the webhook
 * addresses are shown with a copy button for the provider's console.
 */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function useSubmit() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  function submit(fn: () => Promise<ActionResult>, after?: () => void) {
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

export function TelnyxForm({ orgId, dto, canWrite }: { orgId: string; dto: IntegrationDto; canWrite: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [publicKey, setPublicKey] = useState(str(dto.config.publicKey));
  const [connectionId, setConnectionId] = useState(str(dto.config.connectionId));
  const { feedback, isPending, submit } = useSubmit();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveTelnyxAction(orgId, { apiKey: apiKey || undefined, publicKey, connectionId }),
          () => setApiKey(""),
        );
      }}
    >
      <SettingsCard
        title="Keys"
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending || (!dto.hasSecret && !apiKey.trim())}>
              {isPending ? "Saving and testing…" : "Save and test"}
            </Button>
          )
        }
      >
        <SecretInput
          id="telnyx-key"
          label="API key"
          hasSecret={dto.hasSecret}
          value={apiKey}
          onChange={setApiKey}
          placeholder="KEY…"
          help="Telnyx: Mission Control, Keys and credentials, API keys."
        />
        <div className="grid gap-1.5">
          <Label htmlFor="telnyx-public">Public key</Label>
          <Input
            id="telnyx-public"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="Base64, from Keys and credentials, Public key"
            disabled={!canWrite}
          />
          <p className="text-muted-foreground text-[13px]">
            Not a secret. Bananasplit checks every call and text event against it.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="telnyx-connection">Credential connection ID (for calling from the browser)</Label>
          <Input
            id="telnyx-connection"
            inputMode="numeric"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            placeholder="Optional"
            disabled={!canWrite}
          />
        </div>
      </SettingsCard>
    </form>
  );
}

export function TwilioForm({ orgId, dto, canWrite }: { orgId: string; dto: IntegrationDto; canWrite: boolean }) {
  const [accountSid, setAccountSid] = useState(str(dto.config.accountSid));
  const [authToken, setAuthToken] = useState("");
  const { feedback, isPending, submit } = useSubmit();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveTwilioAction(orgId, { accountSid, authToken: authToken || undefined }),
          () => setAuthToken(""),
        );
      }}
    >
      <SettingsCard
        title="Account"
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending || !accountSid.trim()}>
              {isPending ? "Saving and testing…" : "Save and test"}
            </Button>
          )
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="twilio-sid">Account SID</Label>
          <Input
            id="twilio-sid"
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="AC…"
            disabled={!canWrite}
          />
        </div>
        <SecretInput
          id="twilio-token"
          label="Auth token"
          hasSecret={dto.hasSecret}
          value={authToken}
          onChange={setAuthToken}
          placeholder="32 letters and digits"
          help="Twilio console, Account info. Saving also makes the softphone's app and key in your account."
        />
      </SettingsCard>
    </form>
  );
}

export function DeepgramForm({ orgId, dto, canWrite }: { orgId: string; dto: IntegrationDto; canWrite: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const { feedback, isPending, submit } = useSubmit();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(
          () => saveDeepgramAction(orgId, apiKey),
          () => setApiKey(""),
        );
      }}
    >
      <SettingsCard
        title="Key"
        status={feedback && <FeedbackLine feedback={feedback} />}
        footer={
          canWrite && (
            <Button type="submit" disabled={isPending || !apiKey.trim()}>
              {isPending ? "Saving and testing…" : "Save and test"}
            </Button>
          )
        }
      >
        <SecretInput
          id="deepgram-key"
          label="API key"
          hasSecret={dto.hasSecret}
          value={apiKey}
          onChange={setApiKey}
          placeholder="Your Deepgram key"
          help="Deepgram console, API keys. Recordings and voice notes are sent to Deepgram to be written out."
        />
      </SettingsCard>
    </form>
  );
}

/** The account's numbers as buttons, or one typed in. */
export function NumberPicker({
  orgId,
  provider,
  dto,
  canWrite,
}: {
  orgId: string;
  provider: "TELNYX" | "TWILIO";
  dto: IntegrationDto;
  canWrite: boolean;
}) {
  const current = str(dto.config.number);
  const numbers = Array.isArray(dto.config.numbers)
    ? (dto.config.numbers as { number?: unknown; label?: unknown }[]).filter((n) => typeof n.number === "string")
    : [];
  const [typed, setTyped] = useState("");
  const { feedback, isPending, submit } = useSubmit();
  return (
    <SettingsCard
      title="Number"
      description="Calls and texts go out from this number, and replies come back to it."
      status={feedback && <FeedbackLine feedback={feedback} />}
    >
      {numbers.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Numbers on the account">
          {numbers.map((n) => (
            <button
              key={String(n.number)}
              type="button"
              disabled={!canWrite || isPending}
              aria-pressed={current === n.number}
              className={cn(chipClass(current === n.number), "h-8 px-3 text-[13px] tabular-nums")}
              onClick={() => submit(() => setPhoneNumberAction(orgId, provider, String(n.number)))}
            >
              {String(n.number)}
              {typeof n.label === "string" && n.label ? <span className="text-muted-foreground"> {n.label}</span> : null}
            </button>
          ))}
        </div>
      )}
      {canWrite && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => setPhoneNumberAction(orgId, provider, typed),
              () => setTyped(""),
            );
          }}
        >
          <div className="grid min-w-48 flex-1 gap-1.5">
            <Label htmlFor={`${provider}-number`}>{numbers.length ? "Or type one" : "Type the number"}</Label>
            <Input
              id={`${provider}-number`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={current || "+1 555 123 4567"}
              inputMode="tel"
            />
          </div>
          <Button type="submit" variant="outline" disabled={isPending || !typed.trim()}>
            Use this number
          </Button>
        </form>
      )}
    </SettingsCard>
  );
}

/** A webhook address with a copy button. */
export function CopyUrl({ label, url }: { label: string; url: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-foreground text-[13px] font-semibold">{label}</span>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[12.5px]">{url}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(
              () => toast({ title: "Copied." }),
              () => toast({ title: "Couldn't copy. Select it instead.", tone: "error" }),
            );
          }}
        >
          <Copy className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
