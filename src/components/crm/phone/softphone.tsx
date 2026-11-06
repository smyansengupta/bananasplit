"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  dropVoicemailAction,
  recordCallAction,
  softphoneTokenAction,
  startCallAction,
} from "@/app/app/[orgSlug]/crm/phone-actions";
import { Mic, Phone, PowerOff } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { formatDuration, formatNumber } from "@/lib/crm/phone";
import { cn } from "@/lib/utils";

/**
 * The browser softphone (docs/features/crm.md module 5, "Calls"): the
 * organization's Telnyx or Twilio account, the SDK loaded only when a
 * member places a call, a token minted on the server for this member, and
 * a call that can only go to the number on the CRM's own call row. Then:
 * mute, record (after the all-party notice; never when the organization
 * says never), drop the recorded voicemail, hang up, and say how it went.
 */

export interface PhoneCaps {
  /** A provider is connected and calling from the browser is set up. */
  softphone: boolean;
  provider: "telnyx" | "twilio" | null;
  /** The organization allows recording (after the notice). */
  canRecord: boolean;
  /** The organization recorded a voicemail to drop. */
  voicemail: boolean;
}

export type CallState = "idle" | "starting" | "ringing" | "live" | "ended" | "failed";

interface LiveCall {
  hangup: () => void;
  mute: (on: boolean) => void;
}

/** One call at a time, from start to the outcome. */
export function useSoftphone(orgId: string, caps: PhoneCaps) {
  const [state, setState] = useState<CallState>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<LiveCall | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const answeredAt = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (state !== "live") return;
    const t = setInterval(() => {
      if (answeredAt.current) setSeconds(Math.round((Date.now() - answeredAt.current) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => () => cleanup.current?.(), []);

  const ended = useCallback(() => {
    setState((s) => (s === "failed" ? s : "ended"));
    live.current = null;
    cleanup.current?.();
    cleanup.current = null;
  }, []);

  const start = useCallback(
    async (personId: string, options: { record?: boolean } = {}) => {
      setError(null);
      setSeconds(0);
      setMuted(false);
      setRecording(false);
      answeredAt.current = null;
      setState("starting");
      const fail = (message: string) => {
        setError(message);
        setState("failed");
        toast({ title: message, tone: "error" });
      };
      const record = Boolean(options.record) && caps.canRecord && caps.provider === "twilio";
      const started = await startCallAction(orgId, { personId, record }).catch(() => null);
      if (!started || !started.ok) return fail(started && !started.ok ? started.error : "The call didn't start.");
      const { call } = started;
      setCallId(call.callId);
      const token = await softphoneTokenAction(orgId).catch(() => null);
      if (!token || !token.ok) return fail(token && !token.ok ? token.error : "The phone didn't connect.");
      if (!audio.current) {
        audio.current = new Audio();
        audio.current.autoplay = true;
      }
      try {
        if (token.phone.provider === "telnyx") {
          const { TelnyxRTC } = await import("@telnyx/webrtc");
          const client = new TelnyxRTC({ login_token: token.phone.token });
          client.remoteElement = audio.current;
          cleanup.current = () => client.disconnect();
          client.on("telnyx.error", () => fail("The phone lost its connection."));
          client.on("telnyx.ready", () => {
            const c = client.newCall({
              destinationNumber: call.to,
              callerNumber: call.from,
              clientState: btoa(`call:${call.callId}`),
              audio: true,
            });
            live.current = { hangup: () => c.hangup(), mute: (on) => (on ? c.muteAudio() : c.unmuteAudio()) };
            setState("ringing");
          });
          client.on("telnyx.notification", (n: { type?: string; call?: { state?: string } }) => {
            if (n.type !== "callUpdate" || !n.call) return;
            if (n.call.state === "active") {
              answeredAt.current = Date.now();
              setState("live");
            }
            if (n.call.state === "hangup" || n.call.state === "destroy") ended();
          });
          client.connect();
        } else {
          const { Device } = await import("@twilio/voice-sdk");
          const device = new Device(token.phone.token, { closeProtection: true });
          cleanup.current = () => device.destroy();
          const c = await device.connect({ params: { CallId: call.callId, Record: record ? "1" : "0" } });
          live.current = { hangup: () => c.disconnect(), mute: (on) => c.mute(on) };
          setState("ringing");
          if (record) setRecording(true);
          c.on("accept", () => {
            answeredAt.current = Date.now();
            setState("live");
          });
          c.on("disconnect", ended);
          c.on("cancel", ended);
          c.on("reject", ended);
          c.on("error", () => fail("The call dropped."));
        }
      } catch {
        fail("Calling from the browser didn't work here. Use your phone instead.");
      }
    },
    [orgId, caps.canRecord, caps.provider, ended],
  );

  const hangup = useCallback(() => {
    live.current?.hangup();
    ended();
  }, [ended]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      live.current?.mute(!m);
      return !m;
    });
  }, []);

  const record = useCallback(async () => {
    if (!callId) return;
    const r = await recordCallAction(orgId, callId).catch(() => null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "Recording didn't start.", tone: "error" });
      return;
    }
    setRecording(true);
    toast({ title: "The notice is playing. Recording starts when it ends." });
  }, [orgId, callId]);

  const voicemail = useCallback(async () => {
    if (!callId) return;
    const r = await dropVoicemailAction(orgId, callId).catch(() => null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "The voicemail didn't play.", tone: "error" });
      return;
    }
    toast({ title: "Leaving the voicemail. The call ends when it's done." });
  }, [orgId, callId]);

  const reset = useCallback(() => {
    setState("idle");
    setCallId(null);
    setError(null);
    setSeconds(0);
  }, []);

  return { state, callId, seconds, muted, recording, error, start, hangup, toggleMute, record, voicemail, reset };
}

export type Softphone = ReturnType<typeof useSoftphone>;

/** The live call's controls. */
export function CallControls({
  phone,
  caps,
  name,
  number,
}: {
  phone: Softphone;
  caps: PhoneCaps;
  name: string;
  number: string | null;
}) {
  const { state } = phone;
  const on = state === "starting" || state === "ringing" || state === "live";
  return (
    <div className="bg-muted/60 rounded-tile flex flex-wrap items-center gap-3 p-3" role="status" aria-live="polite">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          state === "live" ? "bg-tint-success text-tint-success-foreground" : "bg-card text-muted-foreground",
        )}
      >
        <Phone className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {state === "starting"
            ? "Connecting…"
            : state === "ringing"
              ? `Ringing ${formatNumber(number)}`
              : state === "live"
                ? `${formatDuration(phone.seconds)}${phone.recording ? ", recording" : ""}${phone.muted ? ", muted" : ""}`
                : state === "failed"
                  ? (phone.error ?? "The call didn't connect.")
                  : "Call ended"}
        </p>
      </div>
      {on && (
        <div className="flex flex-wrap items-center gap-1.5">
          {state === "live" && (
            <Button type="button" size="sm" variant="outline" aria-pressed={phone.muted} onClick={phone.toggleMute}>
              <Mic className="size-4" aria-hidden="true" />
              {phone.muted ? "Unmute" : "Mute"}
            </Button>
          )}
          {state === "live" && caps.canRecord && caps.provider === "telnyx" && !phone.recording && (
            <Button type="button" size="sm" variant="outline" onClick={() => void phone.record()}>
              Record
            </Button>
          )}
          {state === "live" && caps.voicemail && (
            <Button type="button" size="sm" variant="outline" onClick={() => void phone.voicemail()}>
              Leave voicemail
            </Button>
          )}
          <Button type="button" size="sm" variant="destructive" onClick={phone.hangup}>
            <PowerOff className="size-4" aria-hidden="true" />
            Hang up
          </Button>
        </div>
      )}
    </div>
  );
}
