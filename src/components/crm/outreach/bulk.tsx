"use client";

import { AlertTriangle, Send, ShieldCheck } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { planBulkAction, sendBulkAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { crmPlanHref } from "@/lib/crm/href";
import { exampleValues, renderMerge } from "@/lib/crm/outreach/merge";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { MergeMenu } from "./compose";

/**
 * Bulk email to a list: who it reaches and who's left out (and why), the
 * sender check, the message with merge fields and a preview, then send.
 * Owners, admins and CRM managers send it, only from the organization's
 * own verified domain.
 */
export function BulkComposer({
  orgId,
  orgSlug,
  lists,
  templates,
  sender,
  canSend,
}: {
  orgId: string;
  orgSlug: string;
  lists: { id: string; name: string; count: number }[];
  templates: { id: string; name: string; subject: string | null; body: string }[];
  sender: { ok: boolean; from: string | null; problem: string | null };
  canSend: boolean;
}) {
  const router = useRouter();
  const [viewId, setViewId] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ recipients: number; left: { reason: string; count: number }[] } | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Hi {{first_name|there}},\n\n\n\n{{my_first_name}}\n{{organization}}");
  const [pending, setPending] = useState(false);
  const preview = useMemo(() => {
    const v = exampleValues();
    return { subject: renderMerge(subject, v).text, body: renderMerge(body, v).text };
  }, [subject, body]);

  const pick = async (id: string) => {
    setViewId(id);
    setPlan(null);
    const r = await runAction(() => planBulkAction(orgId, id));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setPlan(r.plan);
  };

  const send = async () => {
    if (!viewId) return;
    setPending(true);
    const r = await runAction(() => sendBulkAction(orgId, { viewId, subject, body, templateId }));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `Sending to ${r.recipients.toLocaleString("en-US")}`, tone: "success" });
    router.push(crmPlanHref(orgSlug, "campaign", r.campaignId));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-4">
        <section className={cn("rounded-card flex items-start gap-3 p-4 ring-1", sender.ok ? "bg-tint-success/40 ring-foreground/6" : "bg-tint-danger/40 ring-foreground/6")}>
          {sender.ok ? <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{sender.ok ? `Sends from ${sender.from}` : "Your organization's own sender isn't set up"}</p>
            <p className="text-muted-foreground">
              {sender.ok
                ? "Its domain is verified, so SPF and DKIM are in place. Every email has a one-click unsubscribe."
                : sender.problem}
            </p>
            {!sender.ok && (
              <Link href={`/app/${orgSlug}/integrations`} className="font-medium underline underline-offset-4">
                Integrations and apps
              </Link>
            )}
          </div>
        </section>
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
          <h2 className="heading text-base">To</h2>
          {lists.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Save a view of people first, on <Link href={`/app/${orgSlug}/crm/people`} className="underline underline-offset-4">People</Link>.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="List">
              {lists.map((l) => (
                <button key={l.id} type="button" className={cn(chipClass(viewId === l.id), "h-8 px-3")} onClick={() => pick(l.id)}>
                  {l.name} <span className="opacity-70 tabular-nums">{l.count}</span>
                </button>
              ))}
            </div>
          )}
          {plan && (
            <div className="space-y-1 text-sm">
              <p>
                <b className="tabular-nums">{plan.recipients.toLocaleString("en-US")}</b> will get it.
              </p>
              {plan.left.map((l) => (
                <p key={l.reason} className="text-muted-foreground">
                  {l.count} left out: {l.reason}
                </p>
              ))}
            </div>
          )}
        </section>
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Template">
              {templates.slice(0, 8).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={cn(chipClass(templateId === t.id), "h-8 px-3")}
                  onClick={() => {
                    setTemplateId(t.id);
                    setSubject(t.subject ?? "");
                    setBody(t.body);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Subject</span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
          </label>
          <div className="grid gap-1.5 text-sm">
            <div className="flex items-center">
              <span className="text-muted-foreground flex-1">Message</span>
              <MergeMenu onPick={(k) => setBody(`${body}{{${k}}}`)} />
            </div>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
          </div>
          <Button disabled={!canSend || !sender.ok || !plan?.recipients || !subject.trim() || !body.trim() || pending} onClick={send} title={canSend ? undefined : "Owners, admins and CRM managers send bulk email"}>
            <Send className="size-4" aria-hidden="true" />
            Send to {plan?.recipients ? plan.recipients.toLocaleString("en-US") : "the list"}
          </Button>
        </section>
      </div>
      <aside className="space-y-2">
        <h2 className="heading text-base">How it reads</h2>
        <div className="bg-muted/50 space-y-2 rounded-2xl p-4">
          <p className="text-sm font-semibold">{preview.subject || "(no subject)"}</p>
          <p className="text-[15px] whitespace-pre-wrap">{preview.body}</p>
          <p className="text-muted-foreground border-t pt-2 text-xs">Don&apos;t want these emails? Unsubscribe.</p>
        </div>
        <p className="text-muted-foreground text-xs">With example values; each person gets their own.</p>
      </aside>
    </div>
  );
}
