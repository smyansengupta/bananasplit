"use client";

import { Zap } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { restoreToPointAction, undoAction } from "@/app/app/[orgSlug]/crm/actions";
import { cancelEmailAction, composeEmailAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AMBIENT_BUTTON, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmFormCard } from "@/components/crm/card/crm-form-card";
import { LogKindChip, LogWeek } from "@/components/crm/today/today-log";
import { Button } from "@/components/ui/button";
import {
  FormDialogBody,
  FormDialogFoot,
  FormDialogHead,
  FormDialogSwitch,
} from "@/components/ui/form-dialog";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type {
  OnItsOwnKind,
  OnItsOwnSend,
  OnItsOwnUndo,
  OnItsOwnWeek,
} from "@/server/crm/on-its-own";

/**
 * Done on its own (?open=log), in New person's window: the week at a glance,
 * then what the CRM did without anyone clicking, by day, each with why, and
 * Undo where it can really be undone (a send still waiting, a change nothing
 * has touched since) or Send anyway for a draft an automation held for you.
 * The foot goes to Automations, where what it may do alone is changed.
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
  week,
  entries,
}: {
  orgId: string;
  settingsHref: string;
  week: OnItsOwnWeek;
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
    <CrmFormCard>
      {(shut) => (
        <>
          <FormDialogHead
            title="Done on its own"
            description="What the CRM did without asking, this week."
          >
            <FormDialogSwitch
              label="What to show"
              value={tab}
              onChange={setTab}
              options={[
                { value: "all", label: "All", count: entries.length },
                { value: "sent", label: "Sent", count: count("sent") },
                { value: "changed", label: "Changed", count: count("changed") },
                { value: "held", label: "Held back", count: count("held") },
              ]}
            />
          </FormDialogHead>

          <FormDialogBody>
            {week.done + week.held > 0 && (
              <div className="bg-muted rounded-2xl px-4 py-3.5">
                <LogWeek week={week} height={72} />
              </div>
            )}
            {shown.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {tab === "all"
                  ? "Turn on an automation and its work adds up here."
                  : "None of these this week."}
              </p>
            ) : (
              days.map((day) => (
                <section key={day} className="space-y-1">
                  <h3 className="text-sm leading-none font-medium">{day}</h3>
                  <ul className="divide-border divide-y">
                    {shown
                      .filter((e) => e.day === day)
                      .map((row) => {
                        const gone = done[row.id];
                        return (
                          <li key={row.id} className="flex flex-nowrap items-start gap-3 py-3">
                            <LogKindChip kind={row.kind} />
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block text-sm leading-snug",
                                  gone && "text-muted-foreground line-through",
                                )}
                              >
                                {row.text}
                              </span>
                              <AmbientWhy className="mt-1">{row.why}</AmbientWhy>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1.5">
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {row.time}
                              </span>
                              {gone ? (
                                <span className="text-muted-foreground text-xs">{gone}</span>
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
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              ))
            )}
          </FormDialogBody>

          <FormDialogFoot>
            <Button variant="outline" asChild className="sm:me-auto">
              <Link href={settingsHref}>
                <Zap aria-hidden="true" />
                Change what it may do alone
              </Link>
            </Button>
            <Button type="button" onClick={shut}>
              Done
            </Button>
          </FormDialogFoot>
        </>
      )}
    </CrmFormCard>
  );
}
