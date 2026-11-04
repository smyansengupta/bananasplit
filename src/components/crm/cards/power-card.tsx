"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  cancelEmailAction,
  composeEmailAction,
  snoozeAction,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmAvatar, CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { powerHourMinutes } from "@/lib/crm/power-hour";
import { runAction } from "@/lib/run-action";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";

/**
 * Power hour (?open=power): Today's people one at a time. Who they are and
 * why now, their last two touches, and the message (the draft waiting for
 * them, or a blank one) to edit; Send (E), Snooze a week (S) or Skip (J),
 * and who's next. A send waits ten seconds with Undo in a toast. Ends on
 * "That's everyone." with what happened.
 */

export interface PowerPerson {
  id: string;
  name: string;
  sub: string | null;
  whyShort: string;
  why: string;
  recent: string;
  email: boolean;
  phone: string | null;
  draft: { id: string; subject: string; body: string } | null;
  reply: { messageId: string; subject: string } | null;
}

const HOLD_MS = 10_000;

function Key({ k }: { k: string }) {
  return (
    <kbd className="ms-1.5 rounded-md border border-current/25 px-1.5 font-mono text-[11px] leading-4 opacity-70">
      {k}
    </kbd>
  );
}

export function PowerCard({ orgId, people }: { orgId: string; people: PowerPerson[] }) {
  const router = useRouter();
  const { close } = useCrmOpen();
  const [i, setI] = useState(0);
  const [sent, setSent] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const n = people.length;
  const finished = i >= n;
  const p = finished ? null : people[i]!;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (p && shownFor !== p.id) {
    setShownFor(p.id);
    setSubject(p.draft?.subject || (p.reply ? `Re: ${p.reply.subject}` : ""));
    setBody(p.draft?.body ?? "");
  }
  const canEmail = Boolean(p?.email);
  const first = p ? (p.name.split(" ")[0] ?? p.name) : "";
  const next = (kind: "sent" | "skip" | "snooze") => {
    if (kind === "sent") setSent((s) => s + 1);
    if (kind === "skip") setSkipped((s) => s + 1);
    setI((x) => x + 1);
  };

  async function send() {
    if (!p || busy) return;
    if (!canEmail) {
      if (p.phone) window.location.href = `tel:${p.phone}`;
      next("sent");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast({
        title: !subject.trim() ? "Give it a subject." : "Write the message.",
        tone: "error",
      });
      return;
    }
    setBusy(true);
    const who = p;
    const r = await runAction(() =>
      composeEmailAction(orgId, {
        personId: who.id,
        subject: subject.trim(),
        body: body.trim(),
        draftId: who.draft?.id ?? null,
        replyToMessageId: who.reply?.messageId ?? null,
        sendAt: new Date(Date.now() + HOLD_MS + 2000).toISOString(),
        confirmConflict: true,
      }),
    );
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    if ("messageId" in r && r.messageId) {
      const id = r.messageId;
      toast({
        title: `Email to ${who.name} goes out in 10 seconds.`,
        action: {
          label: "Undo",
          run: async () => {
            const u = await cancelEmailAction(orgId, id).catch(() => null);
            if (u?.ok) setSent((s) => Math.max(0, s - 1));
            return u && !u.ok ? u.error : undefined;
          },
        },
      });
    }
    next("sent");
  }

  async function snooze() {
    if (!p || busy) return;
    setBusy(true);
    const r = await runAction(() => snoozeAction(orgId, p.id, "week"));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    next("snooze");
  }

  // E sends, S snoozes, J skips, when you're not typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || hasModifier(event) || isTypingTarget(event) || finished) return;
      const key = event.key.toLowerCase();
      if (key === "e") {
        event.preventDefault();
        void send();
      } else if (key === "s") {
        event.preventDefault();
        void snooze();
      } else if (key === "j") {
        event.preventDefault();
        next("skip");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = finished ? `${n} of ${n}` : `${i + 1} of ${n}, ${sent} sent`;
  const left = finished ? "Done" : `About ${powerHourMinutes(n - i)} min left`;

  return (
    <CrmCard
      title="Power hour"
      description="Today's people, one at a time"
      onClose={() => {
        close();
        router.refresh();
      }}
      foot={
        p ? (
          // Who's next on the left; the buttons on the right, Send last as
          // the one that commits (like a dialog's footer).
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <span className="text-muted-foreground min-w-0 truncate text-[13px]">
              Next: {i + 1 < n ? people[i + 1]!.name : "nobody, last one"}
            </span>
            <div className="ms-auto flex flex-wrap items-center justify-end gap-2.5">
              <Button variant="outline" disabled={busy} onClick={() => next("skip")}>
                Skip
                <Key k="J" />
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void snooze()}>
                Snooze a week
                <Key k="S" />
              </Button>
              <Button disabled={busy} onClick={() => void send()}>
                {canEmail ? "Send" : p.phone ? `Call ${first}` : "Done"}
                <Key k="E" />
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex h-full flex-col gap-4">
        <div className="space-y-1.5">
          <div className="flex text-[13px]">
            <span>{progress}</span>
            <span className="text-muted-foreground ms-auto">{left}</span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-foreground h-full rounded-full transition-[width] duration-300"
              style={{ width: `${n ? Math.round((Math.min(i, n) / n) * 100) : 100}%` }}
            />
          </div>
        </div>
        {n === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            Nobody to reach out to right now.
          </p>
        ) : finished ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="display-title text-[32px]">That&apos;s everyone.</p>
            <p className="text-muted-foreground text-[15px]">
              {sent} sent, {skipped} skipped. Snoozed people come back on the day you chose.
            </p>
            <div className="flex gap-2.5 pt-2">
              <Button
                onClick={() => {
                  close();
                  router.refresh();
                }}
              >
                Back to Today
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setI(0);
                  setSent(0);
                  setSkipped(0);
                  setShownFor(null);
                }}
              >
                Start over
              </Button>
            </div>
          </div>
        ) : (
          p && (
            <>
              <div className="flex items-center gap-3.5">
                <CrmAvatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-xl">{p.name}</b>
                  {p.sub && (
                    <span className="text-muted-foreground block truncate text-sm">{p.sub}</span>
                  )}
                </div>
                <AmbientWhy className="shrink-0 whitespace-nowrap">{p.whyShort}</AmbientWhy>
              </div>
              <div className="bg-muted rounded-[20px] px-4 py-3 text-[15px] leading-relaxed">
                {p.why}
                {p.recent && (
                  <div className="text-muted-foreground pt-1.5 text-[13px]">{p.recent}</div>
                )}
              </div>
              {canEmail ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <b className="text-[15px]">Email {first}</b>
                    <span className="text-muted-foreground ms-auto text-[13px]">
                      {p.draft
                        ? "Drafted by your organization's AI"
                        : "Nothing drafted yet. Write it here."}
                    </span>
                  </div>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    aria-label="Subject"
                    placeholder="Subject"
                  />
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    aria-label="Message"
                    rows={9}
                    className="min-h-48 flex-1 resize-none leading-relaxed"
                  />
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {p.phone
                    ? `No email for ${first}. Call ${p.phone}, then log how it went on their card.`
                    : `No email or number for ${first}. Skip, or add one on their card.`}
                </p>
              )}
            </>
          )
        )}
      </div>
    </CrmCard>
  );
}
