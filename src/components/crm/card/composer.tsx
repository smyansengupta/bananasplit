"use client";

import { ArrowRight, Ban, ChevronDown, FileText, Link2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { logActivityAction } from "@/app/app/[orgSlug]/crm/actions";
import { cancelEmailAction, composeEmailAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { sendTextAction } from "@/app/app/[orgSlug]/crm/phone-actions";
import { AMBIENT_BUTTON } from "@/components/ambient/ambient-button";
import { VoiceNoteButton } from "@/components/crm/phone/voice-note";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A card's one composer (docs/features/crm.md, "Redesign"): a channel pill
 * that cycles Email, Text and Note, the message, and a round send. Sending
 * waits ten seconds with Undo: an email is queued to go then (Undo cancels
 * it), a text or a note is held here (Undo drops it; closing the card sends
 * it right away). `/` lists templates, your booking link and a voice note.
 * A red line says when someone else in the organization reached them lately.
 *
 * Uses outreach's compose, the phone's texts and the timeline's log: no
 * back end of its own.
 */

export type ComposerChannel = "email" | "text" | "note";

export interface ComposerSeed {
  /** Bumped by the parent to apply it again. */
  nonce: number;
  channel?: ComposerChannel;
  subject?: string;
  body?: string;
  replyTo?: { messageId: string; subject: string } | null;
}

const WORDS: Record<ComposerChannel, string> = { email: "Email", text: "Text", note: "Note" };
const HOLD_MS = 10_000;

export function Composer({
  orgId,
  person,
  channels,
  conflict,
  templates,
  booking,
  seed,
  alsoOn = [],
}: {
  orgId: string;
  person: { id: string; name: string };
  channels: { email: boolean; text: boolean };
  /** "Kristine emailed them Oct 30", shown in red while on Email. */
  conflict: string | null;
  templates: readonly { id: string; name: string; subject: string | null; body: string }[];
  booking: string | null;
  seed?: ComposerSeed | null;
  /** Notes also go on these (their company). */
  alsoOn?: { kind: "company" | "deal"; id: string }[];
}) {
  const router = useRouter();
  const order: ComposerChannel[] = [
    ...(channels.email ? ["email" as const] : []),
    ...(channels.text ? ["text" as const] : []),
    "note",
  ];
  const [channel, setChannel] = useState<ComposerChannel>(order[0]!);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ messageId: string; subject: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ label: string; undo: () => void } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; flush: () => void } | null>(null);
  const first = person.name.split(" ")[0] ?? person.name;

  // The parent asks for a draft (Reply, Remind): apply it once per nonce.
  const [applied, setApplied] = useState(0);
  if (seed && seed.nonce !== applied) {
    setApplied(seed.nonce);
    if (seed.channel && order.includes(seed.channel)) setChannel(seed.channel);
    if (seed.subject !== undefined) setSubject(seed.subject);
    if (seed.body !== undefined) setBody(seed.body);
    setReplyTo(seed.replyTo ?? null);
    setTemplateId(null);
  }
  useEffect(() => {
    if (seed?.nonce) input.current?.focus();
  }, [seed?.nonce]);

  // A held text or note goes as soon as the card closes.
  useEffect(
    () => () => {
      if (held.current) {
        clearTimeout(held.current.timer);
        held.current.flush();
      }
    },
    [],
  );

  const placeholder =
    channel === "email"
      ? `Write to ${first}`
      : channel === "text"
        ? `Text ${first}`
        : "Add a note. Promises become tasks.";
  const slash = body.startsWith("/") && !body.includes("\n");
  const query = slash ? body.slice(1).trim().toLowerCase() : "";
  const picks = slash
    ? templates.filter((t) => !query || t.name.toLowerCase().includes(query)).slice(0, 6)
    : [];

  const reset = () => {
    setBody("");
    setSubject("");
    setTemplateId(null);
    setReplyTo(null);
  };

  const finish = (label: string, undo: () => void) => {
    setSent({ label, undo });
    setTimeout(() => setSent((s) => (s && s.label === label ? null : s)), HOLD_MS);
  };

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    if (channel === "email") {
      const subj = (replyTo ? subject || `Re: ${replyTo.subject}` : subject).trim();
      if (!subj) {
        toast({ title: "Give it a subject.", tone: "error" });
        return;
      }
      setBusy(true);
      const r = await runAction(() =>
        composeEmailAction(orgId, {
          personId: person.id,
          subject: subj,
          body: text,
          templateId,
          replyToMessageId: replyTo?.messageId ?? null,
          sendAt: new Date(Date.now() + HOLD_MS + 2000).toISOString(),
          confirmConflict: true,
        }),
      );
      setBusy(false);
      if (!r) return;
      if (!r.ok) return toast({ title: r.error, tone: "error" });
      if (!("messageId" in r) || !r.messageId) return;
      const before = { subject: subj, body: text, replyTo, templateId };
      reset();
      finish("Sending in 10 seconds", async () => {
        const u = await runAction(() => cancelEmailAction(orgId, r.messageId!));
        if (!u) return;
        if (!u.ok) return toast({ title: u.error, tone: "error" });
        setSubject(before.subject);
        setBody(before.body);
        setReplyTo(before.replyTo);
        setTemplateId(before.templateId);
        setSent(null);
        router.refresh();
      });
      router.refresh();
      return;
    }
    // A text or a note waits here for ten seconds.
    const kind = channel;
    const flush = async () => {
      held.current = null;
      const r =
        kind === "text"
          ? await runAction(() => sendTextAction(orgId, person.id, text))
          : await runAction(() =>
              logActivityAction(orgId, {
                kind: "NOTE",
                body: text,
                targets: [{ kind: "person", id: person.id }, ...alsoOn],
              }),
            );
      if (r && !r.ok) toast({ title: r.error, tone: "error" });
      router.refresh();
    };
    const timer = setTimeout(() => void flush(), HOLD_MS);
    held.current = { timer, flush: () => void flush() };
    reset();
    finish(kind === "text" ? "Sending in 10 seconds" : "Saving in 10 seconds", () => {
      if (held.current) clearTimeout(held.current.timer);
      held.current = null;
      setBody(text);
      setSent(null);
    });
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      {channel === "email" && conflict && (
        <span className="text-destructive flex items-center gap-2 ps-1.5 text-[13px]">
          <Ban className="size-3.5 shrink-0" aria-hidden="true" />
          {conflict}
        </span>
      )}
      {slash && (picks.length > 0 || booking || channel === "note") && (
        <div className="bg-popover ring-foreground/10 absolute right-0 bottom-full left-0 mb-2 grid max-h-64 gap-px overflow-y-auto rounded-2xl p-1.5 shadow-lg ring-1">
          {picks.map((t) => (
            <button
              key={t.id}
              type="button"
              className="hover:bg-muted flex items-center gap-2 rounded-xl px-2.5 py-2 text-start text-sm"
              onClick={() => {
                setChannel(order.includes("email") ? "email" : channel);
                setSubject(t.subject ?? t.name);
                setBody(t.body);
                setTemplateId(t.id);
                input.current?.focus();
              }}
            >
              <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
            </button>
          ))}
          {booking && (
            <button
              type="button"
              className="hover:bg-muted flex items-center gap-2 rounded-xl px-2.5 py-2 text-start text-sm"
              onClick={() => {
                setBody(`Here's my booking link if it's easier to pick a time: ${booking}`);
                input.current?.focus();
              }}
            >
              <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              Insert my booking link
            </button>
          )}
          <div className="px-1 py-1">
            <VoiceNoteButton
              orgId={orgId}
              targets={[{ kind: "person", id: person.id }]}
              label="Record a voice note"
              onSaved={() => setBody("")}
            />
          </div>
        </div>
      )}
      {channel === "email" && (body.trim() || subject || replyTo) && (
        <Input
          value={replyTo && !subject ? `Re: ${replyTo.subject}` : subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          aria-label="Subject"
          className="h-9 rounded-full px-4"
        />
      )}
      <div className="border-input flex items-end gap-2 rounded-[22px] border p-1.5">
        <button
          type="button"
          onClick={() => setChannel(order[(order.indexOf(channel) + 1) % order.length]!)}
          title={
            order.length > 1
              ? `Switch between ${order.map((c) => WORDS[c].toLowerCase()).join(", ")}`
              : WORDS[channel]
          }
          className="bg-muted hover:bg-muted-strong inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full ps-3.5 pe-3 text-sm font-semibold"
        >
          {WORDS[channel]}
          {order.length > 1 && <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />}
        </button>
        <textarea
          ref={input}
          value={body}
          rows={1}
          onChange={(e) => {
            setBody(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !slash) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape" && slash) {
              e.stopPropagation();
              setBody("");
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="placeholder:text-muted-foreground min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-[15px] leading-5 outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !body.trim() || slash}
          aria-label="Send"
          title={channel === "note" ? "Save the note" : "Send"}
          className="bg-foreground text-background grid size-9 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-40"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      {sent ? (
        <span className="flex items-center gap-2.5 ps-1.5 text-[13px]">
          <span className="text-muted-foreground">{sent.label}</span>
          <button
            type="button"
            className={cn(
              AMBIENT_BUTTON,
              "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)]",
            )}
            onClick={() => sent.undo()}
          >
            Undo
          </button>
        </span>
      ) : (
        <span className="text-muted-foreground ps-1.5 text-xs">
          Type / for a template, your booking link or a voice note
        </span>
      )}
    </div>
  );
}
