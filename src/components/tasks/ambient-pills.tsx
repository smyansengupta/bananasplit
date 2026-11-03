"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  AMBIENT_BUTTON,
  AmbientButton,
  AmbientWhy,
  MAX_AMBIENT,
  type AmbientAction,
} from "@/components/ambient/ambient-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Ambient buttons whose job needs a word first (src/components/ambient):
 * a small popover with the words already written (Nudge, Ask to unblock,
 * Send a thank-you), a short menu (Push, Still needed?), or one field
 * (Add seats). They look like the shared pill and go once the job's done.
 * Tasks, Calendar and Meetings share them.
 */

// The shared pill's outline look (AmbientButton's default tone).
const PILL = cn(
  AMBIENT_BUTTON,
  "bg-transparent text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8",
);

/** What a pill's job hands back: an error to show, or anything else for done. */
type Outcome = unknown;

function failed(result: Outcome): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { ok?: boolean; error?: unknown };
  if (typeof r.error === "string" && r.error) return r.error;
  if (r.ok === false) return "That didn't go through. Try again.";
  return null;
}

/** Keeps clicks, keys and drags inside a row or board card from opening it. */
function Contained({ children, className }: { children: ReactNode; className?: string }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span
      className={cn("inline-flex", className)}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      {children}
    </span>
  );
}

/** Runs a job, says so, refreshes; reports done to the caller (to step aside). */
function useJob() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (job: () => Promise<Outcome>, done: string | undefined, after: () => void) =>
    start(async () => {
      const result = await runAction(job);
      if (result === undefined) return;
      const error = failed(result);
      if (error) {
        toast({ title: error, tone: "error" });
        return;
      }
      if (done) toast({ title: done });
      after();
      router.refresh();
    });
  return { pending, go };
}

interface PillBase {
  label: string;
  reason: string;
  ariaLabel?: string;
}

/** A popover with a message already written, sent as is or edited. */
export function AmbientMessage({
  label,
  reason,
  ariaLabel,
  hint,
  text,
  send,
  done,
  sendLabel = "Send",
}: PillBase & {
  /** What sending does, in a line ("Comments on the task and mentions Lucas."). */
  hint: string;
  text: string;
  send: (message: string) => Promise<Outcome>;
  done: string;
  sendLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const [message, setMessage] = useState(text);
  const { pending, go } = useJob();
  if (gone) return null;
  return (
    <Contained>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" title={reason} aria-label={ariaLabel} className={PILL}>
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const body = message.trim();
              if (!body || pending) return;
              go(
                () => send(body),
                done,
                () => {
                  setOpen(false);
                  setGone(true);
                },
              );
            }}
          >
            <p className="text-muted-foreground text-[13px]">{hint}</p>
            <Textarea
              autoFocus
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-label={label}
            />
            <Button
              type="submit"
              size="sm"
              className="w-full"
              disabled={!message.trim() || pending}
            >
              {sendLabel}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </Contained>
  );
}

/** A pill that opens a short menu of ways to do the job. */
export function AmbientMenu({
  label,
  reason,
  ariaLabel,
  choices,
}: PillBase & {
  choices: { label: string; run: () => Promise<Outcome>; done?: string }[];
}) {
  const [gone, setGone] = useState(false);
  const { pending, go } = useJob();
  if (gone) return null;
  return (
    <Contained>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={reason}
            aria-label={ariaLabel}
            disabled={pending}
            className={PILL}
          >
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {choices.map((c) => (
            <DropdownMenuItem key={c.label} onSelect={() => go(c.run, c.done, () => setGone(true))}>
              {c.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Contained>
  );
}

/** A pill with one field: a number (Add seats) or a few words. */
export function AmbientField({
  label,
  reason,
  ariaLabel,
  hint,
  initial,
  type = "text",
  submitLabel,
  submit,
  done,
}: PillBase & {
  hint: string;
  initial: string;
  type?: "text" | "number";
  submitLabel: string;
  submit: (value: string) => Promise<Outcome>;
  done?: string;
}) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const [value, setValue] = useState(initial);
  const { pending, go } = useJob();
  if (gone) return null;
  return (
    <Contained>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" title={reason} aria-label={ariaLabel} className={PILL}>
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!value.trim() || pending) return;
              go(
                () => submit(value.trim()),
                done,
                () => {
                  setOpen(false);
                  setGone(true);
                },
              );
            }}
          >
            <p className="text-muted-foreground text-[13px]">{hint}</p>
            <Input
              autoFocus
              type={type}
              min={type === "number" ? 1 : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={label}
            />
            <Button type="submit" size="sm" className="w-full" disabled={!value.trim() || pending}>
              {submitLabel}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </Contained>
  );
}

/** One ambient thing: a plain action (AmbientButton) or a pill made here. */
export type AmbientItem = { key: string; reason: string } & (
  { action: AmbientAction; node?: never } | { node: ReactNode; action?: never }
);

/**
 * AmbientActions for a mix of plain actions and the pills above: the first
 * two, and (with `why`) the first one's reason under them.
 */
export function AmbientRow({
  items,
  why = false,
  className,
  align = "end",
}: {
  items: readonly (AmbientItem | null | false | undefined)[];
  why?: boolean;
  className?: string;
  align?: "start" | "end";
}) {
  const shown = items.filter((i): i is AmbientItem => Boolean(i)).slice(0, MAX_AMBIENT);
  if (shown.length === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-col gap-1",
        align === "end" ? "items-end" : "items-start",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-1.5",
          align === "end" ? "justify-end" : "justify-start",
        )}
      >
        {shown.map((i) =>
          i.action ? (
            <Contained key={i.key}>
              <AmbientButton action={i.action} />
            </Contained>
          ) : (
            <span key={i.key} className="inline-flex">
              {i.node}
            </span>
          ),
        )}
      </span>
      {why && <AmbientWhy>{shown[0]!.reason}</AmbientWhy>}
    </span>
  );
}
