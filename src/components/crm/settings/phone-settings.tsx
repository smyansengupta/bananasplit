"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { savePhoneSettingsAction } from "@/app/app/[orgSlug]/crm/phone-actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { VoiceNoteButton } from "@/components/crm/phone/voice-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, type PhoneSettings } from "@/lib/crm/phone";
import { cn } from "@/lib/utils";

/**
 * The organization's phone settings (owners and admins), each saved as it
 * changes: which connected provider to use, then, under More, whether calls
 * may be recorded and the notice everyone hears first, quiet hours for
 * texts, calling hours for the dialer, and the voicemail to drop.
 */

interface Provider {
  id: "telnyx" | "twilio";
  label: string;
  connected: boolean;
  number: string | null;
}

type Patch = Parameters<typeof savePhoneSettingsAction>[1];

function usePhoneSave(orgId: string, settings: PhoneSettings) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function save(patch: Patch) {
    setPending(true);
    setStatus(null);
    const r = await savePhoneSettingsAction(orgId, patch).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      setStatus({ tone: "error", text: r && !r.ok ? r.error : "That didn't save." });
      return;
    }
    setS(r.settings);
    setStatus({ tone: "ok", text: "Saved." });
    router.refresh();
  }
  return { s, setS, status, pending, save };
}

/** Which account calls and texts go out through. Nothing connected: the keys above come first. */
export function PhoneProviderCard({
  orgId,
  orgSlug,
  settings,
  providers,
}: {
  orgId: string;
  orgSlug: string;
  settings: PhoneSettings;
  providers: Provider[];
}) {
  const { s, status, pending, save } = usePhoneSave(orgId, settings);
  const connected = providers.filter((p) => p.connected);
  if (connected.length === 0) return null;
  return (
    <SettingsCard title="Provider and number" status={<SettingsStatus status={status} />}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Provider">
        {connected.map((p) => {
          const on = (s.provider ?? connected[0]!.id) === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              disabled={pending}
              onClick={() => void save({ provider: p.id })}
              className={cn(chipClass(on), "h-9 px-3 text-[13px]")}
            >
              {p.label}
              {p.number ? (
                <span className="tabular-nums opacity-80"> {formatNumber(p.number)}</span>
              ) : (
                " (pick a number)"
              )}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[13px]">
        The number is picked on the provider&apos;s card on{" "}
        <Link className="underline-offset-2 hover:underline" href={`/app/${orgSlug}/integrations`}>
          Integrations and apps
        </Link>
        .
      </p>
    </SettingsCard>
  );
}

export function PhoneDetails({
  orgId,
  settings,
  timezone,
}: {
  orgId: string;
  settings: PhoneSettings;
  timezone: string;
}) {
  const { s, setS, status, pending, save } = usePhoneSave(orgId, settings);
  const hours = () =>
    void save({
      quietStart: s.quietStart,
      quietEnd: s.quietEnd,
      callStart: s.callStart,
      callEnd: s.callEnd,
    });
  return (
    <div className="space-y-4.5">
      <SettingsCard
        title="Recording"
        description="Everyone hears the notice first. Bananasplit never records without it."
        status={<SettingsStatus status={status} />}
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recording">
          {(
            [
              ["ask", "Members may record, after the notice"],
              ["never", "Never record calls"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={s.recording === id}
              disabled={pending}
              onClick={() => {
                setS({ ...s, recording: id });
                void save({ recording: id, notice: s.notice });
              }}
              className={cn(chipClass(s.recording === id), "h-8 px-3 text-[13px]")}
            >
              {label}
            </button>
          ))}
        </div>
        {s.recording !== "never" && (
          <div className="grid gap-1.5">
            <Label htmlFor="notice">What everyone hears first</Label>
            <Textarea
              id="notice"
              rows={2}
              value={s.notice}
              maxLength={300}
              onChange={(e) => setS({ ...s, notice: e.target.value })}
              onBlur={() => {
                if (s.notice !== settings.notice) {
                  void save({ recording: s.recording, notice: s.notice });
                }
              }}
            />
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Hours" description={`In ${timezone}.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">No texts go out between</legend>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                aria-label="Quiet hours start"
                value={s.quietStart}
                onChange={(e) => setS({ ...s, quietStart: e.target.value })}
                onBlur={hours}
              />
              <span className="text-muted-foreground text-sm">and</span>
              <Input
                type="time"
                aria-label="Quiet hours end"
                value={s.quietEnd}
                onChange={(e) => setS({ ...s, quietEnd: e.target.value })}
                onBlur={hours}
              />
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Calling hours for the dialer</legend>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                aria-label="Calling hours start"
                value={s.callStart}
                onChange={(e) => setS({ ...s, callStart: e.target.value })}
                onBlur={hours}
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="time"
                aria-label="Calling hours end"
                value={s.callEnd}
                onChange={(e) => setS({ ...s, callEnd: e.target.value })}
                onBlur={hours}
              />
            </div>
          </fieldset>
        </div>
      </SettingsCard>

      <SettingsCard title="Voicemail to leave">
        <div className="flex flex-wrap items-center gap-2">
          {s.voicemailKey && (
            <audio
              controls
              preload="none"
              className="h-9 min-w-56 flex-1"
              src={`/api/orgs/${orgId}/crm/audio?voicemail=1`}
            >
              <track kind="captions" />
            </audio>
          )}
          <VoiceNoteButton
            orgId={orgId}
            targets={[]}
            purpose="voicemail"
            label={s.voicemailKey ? "Record a new one" : "Record it"}
          />
          {s.voicemailKey && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => void save({ clearVoicemail: true })}
            >
              Remove
            </Button>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
