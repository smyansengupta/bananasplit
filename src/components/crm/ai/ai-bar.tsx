"use client";

import { Loader2, Upload, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { conversationTextAction } from "@/app/app/[orgSlug]/crm/ai-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

import { CrmPicker } from "../crm-picker";
import { IMAGE_ACCEPT, sendImage, shrinkImage } from "./image";

/*
 * The old AI bar (Ask, Paste a conversation, Scan a card) became the Ask
 * card (?open=ask, src/components/crm/cards/ask-card.tsx). What stays here
 * is Paste a conversation for a record's own AI panel.
 */

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
