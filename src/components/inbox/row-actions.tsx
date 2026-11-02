"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/lib/run-action";

/**
 * The small boxes a row acts through, shared by the Inbox and Home's
 * Waiting on you: Decline (with the reason the requester sees) and Reply
 * (a comment on the mention's task, sent in place).
 */

/** Decline asks why in a small box, since the requester sees the reason. */
export function DeclineButton({
  title,
  onDecline,
}: {
  title: string;
  onDecline: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Decline ${title}`}>
          Decline
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            setOpen(false);
            onDecline(reason.trim());
          }}
        >
          <Input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why, for the requester"
            aria-label="Reason"
          />
          <Button type="submit" size="sm" className="w-full" disabled={!reason.trim()}>
            Decline
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A reply typed in place. onSend resolves true when it went; a throw from
 * it becomes an error toast and the text stays to try again.
 */
export function ReplyBox({
  onSend,
  onCancel,
}: {
  onSend: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const send = () => {
    const text = body.trim();
    if (!text || pending) return;
    start(async () => {
      if (await runAction(() => onSend(text))) setBody("");
    });
  };
  return (
    <div className="space-y-2">
      <Textarea
        autoFocus
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Reply"
        aria-label="Reply"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={!body.trim() || pending}>
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
