"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CirclePause, Mic } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { formatDuration } from "@/lib/crm/phone";

/**
 * Record a voice note and it lands on their timeline (docs/features/crm.md
 * module 12). The browser records (MediaRecorder), the file goes to the
 * audio route, and with Deepgram connected it is written out and summed up
 * there. Ten minutes at most, so it stays under the 4 MB upload cap.
 */

const MAX_SECONDS = 600;

export function VoiceNoteButton({
  orgId,
  targets,
  purpose = "note",
  label = "Voice note",
  size = "sm",
  onSaved,
}: {
  orgId: string;
  targets: { kind: "person" | "company" | "deal"; id: string }[];
  /** "voicemail": the organization's voicemail to drop (settings). */
  purpose?: "note" | "voicemail";
  label?: string;
  size?: "sm" | "default";
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => {
      const s = Math.round((Date.now() - started.current) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) recorder.current?.stop();
    }, 500);
    return () => clearInterval(t);
  }, [state]);

  async function begin() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: "This browser can't record. Try Chrome, Edge, Firefox or Safari.", tone: "error" });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({ title: "Allow the microphone to record a note.", tone: "error" });
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void upload(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), Math.round((Date.now() - started.current) / 1000));
    };
    recorder.current = rec;
    started.current = Date.now();
    setSeconds(0);
    rec.start(1000);
    setState("recording");
  }

  async function upload(blob: Blob, duration: number) {
    if (blob.size < 1000) {
      setState("idle");
      toast({ title: "That was too short to keep." });
      return;
    }
    setState("saving");
    const form = new FormData();
    form.set("file", blob, purpose === "note" ? "voice-note" : "voicemail");
    form.set("purpose", purpose);
    form.set("duration", String(duration));
    form.set("targets", JSON.stringify(targets));
    const res = await fetch(`/api/orgs/${orgId}/crm/audio`, { method: "POST", body: form }).catch(() => null);
    setState("idle");
    const body = (await res?.json().catch(() => null)) as { error?: string; transcribing?: boolean } | null;
    if (!res || !res.ok) {
      toast({ title: body?.error ?? "The recording didn't save.", tone: "error" });
      return;
    }
    toast({
      title:
        purpose === "voicemail"
          ? "Voicemail saved."
          : body?.transcribing
            ? "Saved. It's being written out."
            : "Saved on the timeline as audio.",
    });
    router.refresh();
    onSaved?.();
  }

  if (state === "recording") {
    return (
      <Button type="button" size={size} variant="destructive" onClick={() => recorder.current?.stop()}>
        <CirclePause className="size-4" aria-hidden="true" />
        Stop {formatDuration(seconds)}
      </Button>
    );
  }
  return (
    <Button type="button" size={size} variant="outline" disabled={state === "saving"} onClick={() => void begin()}>
      <Mic className="size-4" aria-hidden="true" />
      {state === "saving" ? "Saving…" : label}
    </Button>
  );
}
