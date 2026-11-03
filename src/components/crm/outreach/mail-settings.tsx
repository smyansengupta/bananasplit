"use client";

import { Check, RotateCcw, UserPlus, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { resolveSuggestionAction, saveMemberSettingsAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { CopyLink } from "./booking";

/**
 * Your mail and the CRM: the address to BCC or forward to, what your mail
 * shares (nothing, who and when, or full messages), what's never logged,
 * your signature, and the people the CRM noticed in your mail.
 */

type Share = "NONE" | "METADATA" | "FULL";

const SHARE: { value: Share; label: string; help: string }[] = [
  { value: "FULL", label: "Full messages", help: "The CRM keeps the subject and what was written, on the person's timeline." },
  { value: "METADATA", label: "Who and when", help: "The CRM sees that you emailed someone, and when, but not what was said." },
  { value: "NONE", label: "Nothing", help: "Your mail never reaches the CRM. Replies to your sequences still stop them." },
];

export function MailSettings({
  orgId,
  initial,
  inboundReady,
}: {
  orgId: string;
  initial: { bccAddress: string | null; shareMode: Share; neverLog: string[]; signature: string | null };
  inboundReady: boolean;
}) {
  const router = useRouter();
  const [share, setShare] = useState<Share>(initial.shareMode);
  const [neverLog, setNeverLog] = useState(initial.neverLog.join("\n"));
  const [signature, setSignature] = useState(initial.signature ?? "");
  const [pending, setPending] = useState(false);
  const save = async (input: Parameters<typeof saveMemberSettingsAction>[1], msg = "Saved") => {
    setPending(true);
    const r = await runAction(() => saveMemberSettingsAction(orgId, input));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: msg, tone: "success" });
    router.refresh();
  };
  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
        <h2 className="heading text-base">Your logging address</h2>
        {initial.bccAddress ? (
          <>
            <p className="text-muted-foreground text-sm">
              BCC it on mail you send, or forward mail to it. Only mail with people already in the CRM, or a company domain it knows, is logged; anyone new is
              suggested below, never added on their own.
            </p>
            <CopyLink url={initial.bccAddress} label="Copy your address" />
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => save({ newBccAddress: true }, "New address made: the old one stops working")}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Make a new address
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {inboundReady ? "Loading your address." : "Incoming mail isn't set up on this server yet (CRM_INBOUND_DOMAIN). Ask whoever runs it."}
          </p>
        )}
      </section>
      <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
        <h2 className="heading text-base">What your mail shares</h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Share">
          {SHARE.map((s) => (
            <button
              key={s.value}
              type="button"
              className={cn(chipClass(share === s.value), "h-8 px-3")}
              onClick={() => {
                setShare(s.value);
                save({ shareMode: s.value });
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">{SHARE.find((s) => s.value === share)?.help}</p>
      </section>
      <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
        <h2 className="heading text-base">Never log</h2>
        <p className="text-muted-foreground text-sm">Addresses or domains, one a line: a doctor, a bank, family.</p>
        <Textarea value={neverLog} onChange={(e) => setNeverLog(e.target.value)} rows={5} placeholder={"@mybank.com\nmom@family.net"} />
        <Button variant="outline" disabled={pending} onClick={() => save({ neverLog })}>
          Save
        </Button>
      </section>
      <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
        <h2 className="heading text-base">Your signature</h2>
        <p className="text-muted-foreground text-sm">Added under everything you send from the CRM.</p>
        <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={5} placeholder={"Ada Lovelace\nSponsorship lead, Robotics Club"} />
        <Button variant="outline" disabled={pending} onClick={() => save({ signature })}>
          Save
        </Button>
      </section>
    </div>
  );
}

export function Suggestions({
  orgId,
  rows,
}: {
  orgId: string;
  rows: { id: string; title: string; summary: string | null; from: string | null }[];
}) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const act = async (id: string, accept: boolean) => {
    const r = await runAction(() => resolveSuggestionAction(orgId, id, accept));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setGone((g) => new Set(g).add(id));
    toast({ title: accept ? "Added" : "Dismissed" });
    if (accept) router.refresh();
  };
  const shown = rows.filter((r) => !gone.has(r.id));
  if (shown.length === 0) return null;
  return (
    <section className="bg-card ring-foreground/6 rounded-card max-w-4xl space-y-3 p-5 ring-1">
      <h2 className="heading flex items-center gap-2 text-base">
        <UserPlus className="text-muted-foreground size-4" aria-hidden="true" />
        People in your mail
      </h2>
      <ul className="divide-border divide-y">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.title}</p>
              <p className="text-muted-foreground truncate text-sm">{[r.summary, r.from].filter(Boolean).join(". ")}</p>
            </div>
            <Button size="sm" onClick={() => act(r.id, true)}>
              <Check className="size-4" aria-hidden="true" />
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act(r.id, false)}>
              <X className="size-4" aria-hidden="true" />
              Dismiss
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
