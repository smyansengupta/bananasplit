"use client";

import { useState, useTransition, type ReactNode } from "react";

import { AmbientButton, type AmbientAction } from "@/components/ambient/ambient-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/lib/run-action";

/**
 * The small boxes a row acts through, shared by the Inbox and Home's
 * Waiting on you: Decline (with the reason the requester sees) and Reply
 * (a comment on the mention's task, sent in place), and AmbientPopover, an
 * ambient button whose job needs a word or a pick first.
 */

/**
 * An ambient button that opens a small box (Decline's reason, a task's
 * title, who to hand one to) instead of running its job at once. The box
 * gets `close` for when it's done.
 */
export function AmbientPopover({
  action,
  children,
  className = "w-72",
}: {
  action: Omit<AmbientAction, "run" | "href" | "external" | "done">;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          {/* Opening the box is all the button does: no result, so it stays. */}
          <AmbientButton
            action={{
              ...action,
              run: async () => {
                setOpen(true);
              },
            }}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent align="end" className={className}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** Decline asks why in a small box, since the requester sees the reason. */
export function DeclineButton({
  title,
  onDecline,
  why,
}: {
  title: string;
  onDecline: (reason: string) => void;
  /** As an ambient button, with why it's here (the Inbox row). */
  why?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (why) {
    return (
      <AmbientPopover
        action={{ key: "decline", label: "Decline", reason: why, ariaLabel: `Decline ${title}` }}
      >
        {(close) => (
          <DeclineForm
            reason={reason}
            setReason={setReason}
            onSubmit={() => {
              close();
              onDecline(reason.trim());
            }}
          />
        )}
      </AmbientPopover>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Decline ${title}`}>
          Decline
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <DeclineForm
          reason={reason}
          setReason={setReason}
          onSubmit={() => {
            setOpen(false);
            onDecline(reason.trim());
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DeclineForm({
  reason,
  setReason,
  onSubmit,
}: {
  reason: string;
  setReason: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onSubmit();
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
  );
}

/**
 * A reply typed in place. onSend resolves true when it went; a throw from
 * it becomes an error toast and the text stays to try again.
 */
export function ReplyBox({
  onSend,
  onCancel,
  suggestions = [],
}: {
  onSend: (body: string) => Promise<boolean>;
  onCancel: () => void;
  /** Short replies sent in one click (a mention left a day). */
  suggestions?: readonly string[];
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
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested replies">
          {suggestions.map((text) => (
            <AmbientButton
              key={text}
              action={{
                key: text,
                label: text,
                reason: "A suggested reply, sent as it is",
                // onSend says how it went itself; a miss leaves the button for another try.
                run: async () => ((await onSend(text)) ? null : undefined),
              }}
            />
          ))}
        </div>
      )}
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
