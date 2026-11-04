"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { acceptQuoteAction, declineQuoteAction } from "./actions";

/** Accept by typing your name, or decline (with a reason if you like). */
export function RespondToQuote({ token, total }: { token: string; total: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(accept: boolean) {
    setPending(true);
    const r = accept ? await acceptQuoteAction(token, name) : await declineQuoteAction(token, reason);
    setPending(false);
    setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  if (message?.ok) {
    return (
      <p role="status" className="bg-tint-success text-tint-success-foreground rounded-tile p-4 text-sm">
        {message.text}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {!declining ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(true);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="sign-name">Type your full name to accept</Label>
            <Input
              id="sign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Your full name"
              className="text-lg"
            />
            <p className="text-muted-foreground text-xs">
              Typing your name and pressing Accept is your signature for {total}. We keep the name and the time.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || name.trim().length < 2}>
              {pending ? "Accepting…" : "Accept"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="decline-reason">Why not? (optional)</Label>
            <Textarea id="decline-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Sending…" : "Decline"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {message && !message.ok && (
        <p role="alert" className="text-destructive text-sm">
          {message.text}
        </p>
      )}
    </div>
  );
}
