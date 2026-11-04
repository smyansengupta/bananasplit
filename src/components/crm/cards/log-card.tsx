"use client";

import { Zap } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { restoreToPointAction, undoAction } from "@/app/app/[orgSlug]/crm/actions";
import { cancelEmailAction, composeEmailAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AMBIENT_BUTTON, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmCard, CrmCardButton } from "@/components/crm/card/crm-card";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { OnItsOwnKind, OnItsOwnSend, OnItsOwnUndo } from "@/server/crm/on-its-own";

/**
 * Done on its own (?open=log): what the CRM did without anyone clicking,
 * by day, each with why, and Undo where it can really be undone (a send
 * still waiting, a change nothing has touched since) or Send anyway for a
 * draft an automation held for you. A round button goes to Automations,
 * where what it may do alone is changed.
 */

export interface LogRow {
  id: string;
  kind: OnItsOwnKind;
  day: string;
  time: string;
  text: string;
  why: string;
  undo: OnItsOwnUndo | null;
  send: OnItsOwnSend | null;
}

const OUTLINE =
  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-muted";

export function LogCard({
  orgId,
  settingsHref,
  entries,
}: {
  orgId: string;
  settingsHref: string;
  entries: LogRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | OnItsOwnKind>("all");
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const count = (k: OnItsOwnKind) => entries.filter((e) => e.kind === k).length;
  const shown = entries.filter((e) => tab === "all" || e.kind === tab);
  const days = [...new Set(shown.map((e) => e.day))];

  async function undo(row: LogRow) {
    if (!row.undo) return;
    setBusy(row.id);
    if (row.undo.type === "cancel-email") {
      const r = await runAction(() =>
        cancelEmailAction(orgId, (row.undo as { messageId: string }).messageId),
      );
      setBusy(null);
      if (!r) return;
      if (!r.ok) return toast({ title: r.error, tone: "error" });
      setDone((d) => ({ ...d, [row.id]: "Won't send" }));
    } else {
      const u = row.undo;
      const r = await runAction(() => restoreToPointAction(orgId, u.kind, u.id, u.before));
      setBusy(null);
      if (!r) return;
      if (!r.ok) return toast({ title: r.error, tone: "error" });
      setDone((d) => ({ ...d, [row.id]: "Undone" }));
      if (r.fields) {
        toast({
          title: "Put back as it was.",
          action: {
            label: "Undo",
            run: async () => {
              const back = await undoAction(orgId, r.batchId).catch(() => null);
              setDone((d) => {
                const next = { ...d };
                delete next[row.id];
                return next;
              });
              router.refresh();
              return back && !back.ok ? back.error : undefined;
            },
          },
        });
      }
    }
    router.refresh();
  }

  async function send(row: LogRow) {
    if (!row.send) return;
    const s = row.send;
    setBusy(row.id);
    const r = await runAction(() =>
      composeEmailAction(orgId, {
        personId: s.personId,
        subject: s.subject,
        body: s.body,
        draftId: s.draftId,
        confirmConflict: true,
      }),
    );
    setBusy(null);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setDone((d) => ({ ...d, [row.id]: "Sent" }));
    router.refresh();
  }

  return (
    <CrmCard
      title="Done on its own"
      subtitle="What the CRM did without asking, this week"
      description="What the CRM did without asking, with Undo where it can be undone"
      actions={
        <CrmCardButton label="Change what it may do alone" href={settingsHref}>
          <Zap className="size-4" aria-hidden="true" />
        </CrmCardButton>
      }
      tabs={[
        { value: "all", label: "All", count: entries.length || undefined },
        { value: "sent", label: "Sent", count: count("sent") || undefined },
        { value: "changed", label: "Changed", count: count("changed") || undefined },
        { value: "held", label: "Held back", count: count("held") || undefined },
      ]}
      tab={tab}
      onTab={(v) => setTab(v as typeof tab)}
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">Nothing here this week.</p>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day} className="space-y-1">
              <h3 className="heading text-muted-foreground px-1 text-[13px]">{day}</h3>
              <ul className="divide-border divide-y">
                {shown
                  .filter((e) => e.day === day)
                  .map((row) => {
                    const gone = done[row.id];
                    return (
                      <li key={row.id} className="flex flex-nowrap items-start gap-3 px-1 py-3">
                        <span className="text-muted-foreground w-16 shrink-0 pt-0.5 text-xs tabular-nums">
                          {row.time}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-[15px] leading-snug",
                              gone && "text-muted-foreground line-through",
                            )}
                          >
                            {row.text}
                          </span>
                          <AmbientWhy className="mt-1">{row.why}</AmbientWhy>
                        </span>
                        {gone ? (
                          <span className="text-muted-foreground shrink-0 pt-0.5 text-xs">
                            {gone}
                          </span>
                        ) : row.undo ? (
                          <button
                            type="button"
                            disabled={busy === row.id}
                            className={cn(AMBIENT_BUTTON, OUTLINE)}
                            onClick={() => void undo(row)}
                          >
                            Undo
                          </button>
                        ) : row.send ? (
                          <button
                            type="button"
                            disabled={busy === row.id}
                            className={cn(
                              AMBIENT_BUTTON,
                              "bg-foreground text-background hover:bg-foreground/90",
                            )}
                            onClick={() => void send(row)}
                          >
                            Send anyway
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </CrmCard>
  );
}
