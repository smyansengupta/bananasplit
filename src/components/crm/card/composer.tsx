"use client";

import { ArrowRight, Ban, ChevronDown, FileText, Link2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { logActivityAction } from "@/app/app/[orgSlug]/crm/actions";
import { draftNoteTaskAction } from "@/app/app/[orgSlug]/crm/note-actions";
import { cancelEmailAction, composeEmailAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { sendTextAction } from "@/app/app/[orgSlug]/crm/phone-actions";
import { AMBIENT_BUTTON } from "@/components/ambient/ambient-button";
import { VoiceNoteButton } from "@/components/crm/phone/voice-note";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import type { NoteTaskDraft } from "@/lib/crm/note-task";
import { cn } from "@/lib/utils";

import { TaskPreview } from "./task-preview";

/**
 * A card's one composer (docs/features/crm.md, "Redesign"): a channel pill
 * that cycles Email, Text, Note and Task, the message, and a round send.
 * Task has the organization's AI write a task from what you typed ("Marcus
 * doesn't like the new export, for Kristine") and shows it above to change
 * and make with Create task (docs/features/crm.md, "Notes and tasks"). Sending
 * waits ten seconds with Undo: an email is queued to go then (Undo cancels
 * it), a text or a note is held here (Undo drops it; closing the card sends
 * it right away). `/` lists templates, your booking link and a voice note.
 * A red line says when someone else in the organization reached them lately.
 *
 * Uses outreach's compose, the phone's texts, the timeline's log and the
 * notes' task drafts: no back end of its own. A company's card has Note
 * and Task only.
 */

export type ComposerChannel = "email" | "text" | "note" | "task";

export interface ComposerSeed {
  /** Bumped by the parent to apply it again. */
  nonce: number;
  channel?: ComposerChannel;
  subject?: string;
  body?: string;
  replyTo?: { messageId: string; subject: string } | null;
}

const WORDS: Record<ComposerChannel, string> = { email: "Email", text: "Text", note: "Note", task: "Task" };
const HOLD_MS = 10_000;

export function Composer({
  orgId,
  orgSlug,
  record,
  members,
  channels,
  conflict,
  templates,
  booking,
  seed,
  alsoOn = [],
}: {
  orgId: string;
  orgSlug: string;
  /** Who it's to or about. Email and Text are a person's only. */
  record: { kind: "person" | "company"; id: string; name: string };
  /** For the Task channel's assignee. */
  members: readonly { id: string; name: string }[];
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
    "task",
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
  const [taskDraft, setTaskDraft] = useState<{ draft: NoteTaskDraft; text: string } | null>(null);
  const first = record.name.split(" ")[0] ?? record.name;

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

  // A held text or note goes as soon as the card closes, or the tab is
  // hidden or left (closing it, going to another page): never lost.
  useEffect(() => {
    const flushNow = () => {
      if (held.current) {
        clearTimeout(held.current.timer);
        held.current.flush();
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onHidden);
      flushNow();
    };
  }, []);

  const placeholder =
    channel === "email"
      ? `Write to ${first}`
      : channel === "text"
        ? `Text ${first}`
        : channel === "note"
          ? "Add a note. Promises become tasks."
          : `A task about ${first}. Add "for" and a name to hand it over.`;
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
    if (channel === "task") {
      setBusy(true);
      const r = await runAction(() =>
        draftNoteTaskAction(orgId, { target: { kind: record.kind, id: record.id }, text }),
      );
      setBusy(false);
      if (!r) return;
      if (!r.ok) return toast({ title: r.error, tone: "error" });
      setTaskDraft({ draft: r.draft, text });
      reset();
      return;
    }
    if (channel === "email") {
      const subj = (replyTo ? subject || `Re: ${replyTo.subject}` : subject).trim();
      if (!subj) {
        toast({ title: "Give it a subject.", tone: "error" });
        return;
      }
      setBusy(true);
      const r = await runAction(() =>
        composeEmailAction(orgId, {
          personId: record.id,
          subject: subj,
          body: text,
          templateId,
          replyToMessageId: replyTo?.messageId ?? null,
          // Held on the server's clock (a wrong clock here can't skip Undo).
          holdSeconds: HOLD_MS / 1000 + 2,
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
          ? await runAction(() => sendTextAction(orgId, record.id, text))
          : await runAction(() =>
              logActivityAction(orgId, {
                kind: "NOTE",
                body: text,
                targets: [{ kind: record.kind, id: record.id }, ...alsoOn],
              }),
            );
      if (r && !r.ok) toast({ title: r.error, tone: "error" });
      router.refresh();
    };
    const timer = setTimeout(() => void flush(), HOLD_MS);
    held.current = { timer, flush: () => void flush() };
    reset();
    finish(kind === "text" ? "Sending in 10 seconds" : "Saving in 10 seconds", () => {
      // Already gone (the tab was hidden or left): nothing to take back here.
      if (!held.current) {
        setSent(null);
        toast({ title: kind === "text" ? "That text already went." : "That note is already saved." });
        return;
      }
      clearTimeout(held.current.timer);
      held.current = null;
      setBody(text);
      setSent(null);
    });
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      {taskDraft && (
        <TaskPreview
          orgId={orgId}
          orgSlug={orgSlug}
          target={{ kind: record.kind, id: record.id }}
          draft={taskDraft.draft}
          members={members}
          className="mb-1 max-h-[46vh] overflow-y-auto"
          onDone={() => setTaskDraft(null)}
          onCancel={() => {
            setBody(taskDraft.text);
            setTaskDraft(null);
            input.current?.focus();
          }}
        />
      )}
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
              targets={[{ kind: record.kind, id: record.id }]}
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
          title={channel === "note" ? "Save the note" : channel === "task" ? "Write the task" : "Send"}
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
      ) : channel === "task" ? (
        <span className="text-muted-foreground ps-1.5 text-xs">
          {busy ? "Writing the task…" : "You check the task before it's made"}
        </span>
      ) : (
        <span className="text-muted-foreground ps-1.5 text-xs">
          Type / for a template, your booking link or a voice note
        </span>
      )}
    </div>
  );
}
