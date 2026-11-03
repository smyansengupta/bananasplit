"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { sendTextAction, setConsentAction, textThreadAction } from "@/app/app/[orgSlug]/crm/phone-actions";
import { Send } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { CONSENT_HOW } from "@/lib/crm/phone";
import { cn } from "@/lib/utils";

/**
 * Texting one person (docs/features/crm.md module 5): their thread, newest
 * last, and a box to write in. The first text needs their consent, recorded
 * with how they gave it; someone who texted STOP can't be texted until they
 * text START. Quiet hours hold a text until morning.
 */

export interface TextRow {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  sentAt: string;
}

export function TextThread({
  orgId,
  personId,
  texts,
  consent,
  enabled,
  onChange,
}: {
  orgId: string;
  personId: string;
  /** Called after a send or a consent change (a window reloads its thread). */
  onChange?: () => void;
  texts: TextRow[];
  /** granted, opted-out (texted STOP), or none yet. */
  consent: "granted" | "opted-out" | "none";
  /** A provider and a number are set up. */
  enabled: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [how, setHow] = useState<string>(CONSENT_HOW[0].id);

  async function send() {
    setPending(true);
    const r = await sendTextAction(orgId, personId, body).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "The text didn't send.", tone: "error" });
      return;
    }
    setBody("");
    toast({
      title: r.waiting
        ? `It's quiet hours, so it goes at ${new Date(r.sendAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`
        : "Sending.",
    });
    router.refresh();
    onChange?.();
  }

  async function grant() {
    setPending(true);
    const label = CONSENT_HOW.find((c) => c.id === how)?.label ?? how;
    const r = await setConsentAction(orgId, personId, "text", { granted: true, how: label }).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
      return;
    }
    router.refresh();
    onChange?.();
  }

  return (
    <div className="space-y-3">
      {texts.length > 0 && (
        <ol className="max-h-72 space-y-1.5 overflow-y-auto pr-1" aria-label="Texts">
          {texts.map((t) => (
            <li key={t.id} className={cn("flex", t.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                  t.direction === "OUTBOUND" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {t.body}
                <span className={cn("mt-0.5 block text-[11px]", t.direction === "OUTBOUND" ? "opacity-75" : "text-muted-foreground")}>
                  {new Date(t.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {t.direction === "OUTBOUND" && t.status !== "sent" && t.status !== "delivered" ? `, ${t.status}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {!enabled ? (
        <p className="text-muted-foreground text-sm">
          Connect Telnyx or Twilio on Integrations and apps to text from here.
        </p>
      ) : consent === "opted-out" ? (
        <p className="text-muted-foreground text-sm">They texted STOP. They can text START to get texts again.</p>
      ) : consent === "none" ? (
        <div className="space-y-2">
          <p className="text-sm">Before the first text, record how they agreed to texts.</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="How they agreed">
            {CONSENT_HOW.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={how === c.id}
                onClick={() => setHow(c.id)}
                className={cn(chipClass(how === c.id), "h-auto min-h-8 px-3 py-1 text-left text-[13px] whitespace-normal")}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void grant()}>
            They said yes to texts
          </Button>
        </div>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Write a text"
            aria-label="Text"
            className="min-h-0 flex-1"
          />
          <Button type="submit" size="icon" disabled={pending || !body.trim()} aria-label="Send text">
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </form>
      )}
    </div>
  );
}

/** Texting one person in a window (the follow-up queue's text button): their thread, consent and the box. */
export function TextDialog({ orgId, personId, name, onClose }: { orgId: string; personId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<{ texts: TextRow[]; consent: "granted" | "opted-out" | "none"; enabled: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void textThreadAction(orgId, personId)
      .catch(() => null)
      .then((r) => {
        if (!live) return;
        if (!r || !r.ok) {
          toast({ title: r && !r.ok ? r.error : "That didn't load.", tone: "error" });
          return;
        }
        setData({ texts: r.texts, consent: r.consent, enabled: r.enabled });
      });
    return () => {
      live = false;
    };
  }, [orgId, personId, version]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Text {name}</DialogTitle>
          <DialogDescription>From your organization&apos;s number. It lands on their timeline.</DialogDescription>
        </DialogHeader>
        {data ? (
          <TextThread
            orgId={orgId}
            personId={personId}
            texts={data.texts}
            consent={data.consent}
            enabled={data.enabled}
            onChange={() => setVersion((v) => v + 1)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
