"use client";

import { ClipboardPaste, Loader2, ScanLine, Sparkles, Upload, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { askAction, conversationTextAction } from "@/app/app/[orgSlug]/crm/ai-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import type { TargetKind } from "@/lib/crm/suggestions";
import { cn } from "@/lib/utils";

import { CrmPicker } from "../crm-picker";
import { IMAGE_ACCEPT, sendImage, shrinkImage } from "./image";

/**
 * The CRM's AI bar: Ask (questions in plain words over what the member can
 * see), Paste a conversation (a chat's text or screenshot into the review
 * queue) and Scan a card (the phone-first capture page).
 */
export function CrmAiBar({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{
    q: string;
    answer: string;
    results: { n: string; kind: TargetKind; id: string; name: string; sub: string | null }[];
    cites: string[];
    readBy: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    const r = await askAction(orgId, q).catch(() => null);
    setAsking(false);
    if (!r || !r.ok) {
      setError(r && !r.ok ? r.error : "That didn't work. Try again.");
      return;
    }
    setAnswer({ q, answer: r.answer, results: r.results, cites: r.cites, readBy: r.readBy });
  };

  const cited = answer ? answer.results.filter((r) => answer.cites.includes(r.n)) : [];
  const others = answer ? answer.results.filter((r) => !answer.cites.includes(r.n)) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={ask} className="relative min-w-0 flex-[1_1_18rem]" role="search">
          <Sparkles className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask the CRM: who haven't we talked to in 60 days?"
            aria-label="Ask the CRM"
            maxLength={500}
            className="h-10 rounded-full ps-10 pe-24"
          />
          <Button type="submit" size="sm" disabled={asking || !question.trim()} className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full">
            {asking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Ask
          </Button>
        </form>
        <Button variant="outline" onClick={() => setPasting(true)}>
          <ClipboardPaste className="size-4" aria-hidden="true" />
          Paste a conversation
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/app/${orgSlug}/crm/scan`}>
            <ScanLine className="size-4" aria-hidden="true" />
            Scan a card
          </Link>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {answer && (
        <Card className="gap-3 p-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-[15px] leading-relaxed">{answer.answer}</p>
            <Button variant="ghost" size="icon" aria-label="Close the answer" onClick={() => setAnswer(null)}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {answer.results.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {[...cited, ...others].slice(0, 12).map((r) => (
                <li key={r.n}>
                  <Link
                    href={crmRecordHref(orgSlug, r.kind, r.id)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] hover:bg-muted",
                      answer.cites.includes(r.n) ? "border-transparent bg-tint-info text-tint-info-foreground" : "border-input",
                    )}
                  >
                    <b className="font-semibold">{r.name}</b>
                    {r.sub && <span className="text-muted-foreground max-w-48 truncate">{r.sub}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">Answered by {answer.readBy} from what you can see in the CRM.</p>
        </Card>
      )}
      <PasteConversation orgId={orgId} open={pasting} onOpenChange={setPasting} />
    </div>
  );
}

/** A chat's text or screenshot: who it's with and what's next, into the review queue. */
export function PasteConversation({
  orgId,
  open,
  onOpenChange,
  person,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** On a person's page: it's with them. */
  person?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [who, setWho] = useState<{ id: string; label: string } | null>(person ? { id: person.id, label: person.name } : null);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  const take = async (file: File) => {
    const blob = await shrinkImage(file);
    setImage((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { blob, url: URL.createObjectURL(blob) };
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void take(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  const reset = () => {
    setText("");
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
    if (!person) setWho(null);
  };

  const submit = async () => {
    setBusy(true);
    let r: { error?: string; queued?: number; matched?: { name: string } | null } | null;
    if (image) {
      r = (await sendImage(orgId, image.blob, { purpose: "conversation", ...(who ? { personId: who.id } : {}), ...(text.trim() ? { text } : {}) })) as typeof r;
    } else {
      const a = await conversationTextAction(orgId, text, who?.id ?? null).catch(() => null);
      r = !a ? { error: "That didn't work. Try again." } : a.ok ? { queued: a.queued, matched: a.matched } : { error: a.error };
    }
    setBusy(false);
    if (!r || r.error) {
      toast({ title: r?.error ?? "That didn't work.", tone: "error" });
      return;
    }
    toast({
      title: r.matched ? `Read the conversation with ${r.matched.name}.` : "Read the conversation.",
      description: `${r.queued ?? 0} ${r.queued === 1 ? "suggestion waits" : "suggestions wait"} in Review.`,
      tone: "success",
    });
    reset();
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Paste a conversation</DialogTitle>
          <DialogDescription>
            Text or a screenshot from WhatsApp, LinkedIn, Instagram, texts or email. Your organization&apos;s AI finds who
            it&apos;s with and what&apos;s next; everything waits in Review for you to accept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!person && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">With</span>
              <CrmPicker
                orgId={orgId}
                kind="person"
                value={who?.id ?? null}
                display={who?.label ?? null}
                placeholder="Find them for me"
                onPick={(hit) => setWho(hit ? { id: hit.id, label: hit.label } : null)}
              />
            </div>
          )}
          {image ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="The screenshot to read" className="max-h-72 w-full rounded-2xl object-contain ring-1 ring-foreground/10" />
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-2 right-2"
                aria-label="Remove the screenshot"
                onClick={() => {
                  URL.revokeObjectURL(image.url);
                  setImage(null);
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <Textarea
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Paste the messages here, or paste a screenshot (Ctrl+V).\n\nMara: Thanks for the tour! I'll confirm the budget in March.\nMe: Great, I'll send the deck Friday."}
              aria-label="The conversation"
              maxLength={20_000}
            />
          )}
          <input
            ref={pick}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void take(f);
              e.target.value = "";
            }}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {!image ? (
            <Button variant="ghost" onClick={() => pick.current?.click()}>
              <Upload className="size-4" aria-hidden="true" />
              Pick a screenshot
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit} disabled={busy || (!image && text.trim().length < 5)}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? "Reading…" : "Read it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
